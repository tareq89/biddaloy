#!/usr/bin/env python3
"""Resolve a hand-typed, ordered list of issue refs into a stacked-branch plan.

Unlike `ship-epic/scripts/epic_plan.py`, this does not derive order from a
dependency graph — the caller already knows the order they want (that is the
whole point of this skill: the user typed it out, branch by branch). What
this script does is the part a human gets wrong under repetition:

- A ref can be a bare issue number ("131") or the repo's dotted phase id
  ("8.7.3", with or without a leading '#') — both need to resolve to the same
  real GitHub issue and the same `feature-<dotted>` branch name.
- Two refs can name the *same* issue under two different labels (a phase got
  renumbered after the plan was written, say). Building that issue twice
  would produce an empty second PR with nothing left to close. This collapses
  same-issue refs into one step, keeping the first position and recording
  what got merged so the caller can report it.

Usage:
    resolve_stack.py <ref> [<ref> ...] [--repo owner/name] [--json]

Output (human-readable by default, --json for machine consumption): the
resolved, deduplicated, ordered plan — each step's issue number, title,
branch name, and which base branch it stacks on (the previous step's branch,
or 'origin/main' for the first).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

TITLE_PREFIX = re.compile(r"^\s*\[(?:Epic\s+)?([0-9]+(?:\.[0-9]+)*)\]")
DOTTED_REF = re.compile(r"^#?([0-9]+\.[0-9]+(?:\.[0-9]+)*)$")
BARE_NUMBER = re.compile(r"^#?([0-9]+)$")


def run_gh(args: list[str]) -> str:
    out = subprocess.run(["gh", *args], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"gh {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout


def current_repo() -> str:
    out = run_gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
    return out.strip()


def find_issue_by_dotted(repo: str, dotted: str) -> dict | None:
    """Search open+closed issues for a `[dotted] Title` prefix match.

    `gh issue list --search` full-text matches the bracket token reliably
    enough as a narrowing filter, but the actual match still has to be the
    regex against the real title — search is fuzzy, `TITLE_PREFIX` is not.
    """
    raw = run_gh(
        [
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "all",
            "--search",
            f'"[{dotted}]" in:title',
            "--json",
            "number,title,state",
            "--limit",
            "20",
        ]
    )
    candidates = json.loads(raw)
    for candidate in candidates:
        match = TITLE_PREFIX.match(candidate["title"])
        if match and match.group(1) == dotted:
            return candidate
    return None


def find_issue_by_number(repo: str, number: int) -> dict | None:
    raw = run_gh(
        ["issue", "view", str(number), "--repo", repo, "--json", "number,title,state"]
    )
    return json.loads(raw)


def resolve_ref(repo: str, ref: str) -> dict:
    dotted_match = DOTTED_REF.match(ref)
    if dotted_match:
        dotted = dotted_match.group(1)
        issue = find_issue_by_dotted(repo, dotted)
        if not issue:
            sys.exit(f'no issue found with title prefix "[{dotted}]" — check the ref "{ref}"')
        return {"ref": ref, **issue, "dotted": dotted}

    bare_match = BARE_NUMBER.match(ref)
    if bare_match:
        number = int(bare_match.group(1))
        issue = find_issue_by_number(repo, number)
        if not issue:
            sys.exit(f"issue #{number} not found — check the ref \"{ref}\"")
        title_match = TITLE_PREFIX.match(issue["title"])
        dotted = title_match.group(1) if title_match else None
        return {"ref": ref, **issue, "dotted": dotted}

    sys.exit(f'unrecognized ref "{ref}" — expected a bare number ("131") or a dotted id ("8.7.3")')


def build_plan(repo: str, refs: list[str]) -> dict:
    resolved = [resolve_ref(repo, ref) for ref in refs]

    seen: dict[int, dict] = {}
    steps: list[dict] = []
    collapsed: list[dict] = []

    for item in resolved:
        number = item["number"]
        if number in seen:
            collapsed.append({"ref": item["ref"], "collapsed_into_ref": seen[number]["ref"], "number": number})
            continue
        seen[number] = item
        steps.append(item)

    plan = []
    previous_branch = "origin/main"
    for step in steps:
        dotted = step["dotted"]
        if not dotted:
            sys.exit(
                f'issue #{step["number"]} ("{step["title"]}") has no "[N.M...]" title prefix — '
                "cannot derive a feature-<dotted> branch name for it. Fix the title or handle "
                "this one manually."
            )
        branch = f"feature-{dotted}"
        plan.append(
            {
                "ref": step["ref"],
                "number": step["number"],
                "title": step["title"],
                "state": step["state"],
                "branch": branch,
                "base": previous_branch,
            }
        )
        previous_branch = branch

    return {"plan": plan, "collapsed": collapsed}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("refs", nargs="+", help="Ordered issue refs, e.g. 131 132 8.7.3 133")
    parser.add_argument("--repo", help="owner/name (defaults to the current repo)")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    repo = args.repo or current_repo()
    result = build_plan(repo, args.refs)

    if args.json:
        print(json.dumps(result, indent=2))
        return

    for i, step in enumerate(result["plan"], 1):
        closed = " (already closed)" if step["state"] == "CLOSED" else ""
        print(f'{i}. #{step["number"]} [{step["ref"]}] "{step["title"]}"{closed}')
        print(f'   branch {step["branch"]}  <-  base {step["base"]}')

    if result["collapsed"]:
        print("\nCollapsed (same issue referenced more than once):")
        for c in result["collapsed"]:
            print(f'  "{c["ref"]}" is the same issue as an earlier ref — collapsed, not rebuilt')


if __name__ == "__main__":
    main()
