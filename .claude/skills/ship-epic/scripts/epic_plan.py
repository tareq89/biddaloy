#!/usr/bin/env python3
"""Order an epic's sub-issues into a safe execution sequence.

Sub-issue bodies declare dependencies with the repo's dotted task numbering
(``**Depends on:** #8.1.1``), which is *not* a GitHub issue number — GitHub
renders that as a link to issue 8 followed by the text ".1.1". So dependencies
have to be resolved through the ``[N.M.K] Title`` prefix instead, which is what
this script does.

Usage:
    epic_plan.py <epic-number> [--repo owner/name] [--json]

Output is the execution order, with each item's state and anything blocking it.
Exit code is 1 if the graph has a cycle, since that needs a human.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict

SUB_ISSUES_QUERY = """
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    issue(number:$number) {
      number title state
      subIssues(first:100) {
        totalCount
        nodes {
          number title state body
          labels(first:20) { nodes { name } }
        }
      }
    }
  }
}
"""

# "[8.1.1] Add ui workspace" -> "8.1.1"
TITLE_PREFIX = re.compile(r"^\s*\[(?:Epic\s+)?([0-9]+(?:\.[0-9]+)*)\]")
# "**Depends on:** #8.1.1, #8.2.x" -> "#8.1.1, #8.2.x"
DEPENDS_LINE = re.compile(r"\*\*Depends on:\*\*\s*(.+?)(?:\s*·|$)", re.MULTILINE)
# "#8.1.1" / "#102" / "#8.2.x"
DEP_TOKEN = re.compile(r"#([0-9]+(?:\.[0-9]+)*(?:\.x)?)")

NONE_WORDS = {"nothing", "none", "n/a", "-", "—"}


def gh_graphql(query: str, **variables) -> dict:
    cmd = ["gh", "api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        flag = "-F" if isinstance(value, int) else "-f"
        cmd += [flag, f"{key}={value}"]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"gh api failed: {out.stderr.strip()}")
    return json.loads(out.stdout)


def dotted_key(dotted: str) -> tuple:
    """Sort key so 8.1.2 < 8.1.10 and 8.2.1 follows all of 8.1.*"""
    return tuple(int(p) for p in dotted.split(".") if p.isdigit())


def parse_dependencies(body: str) -> list[str]:
    """Return raw dependency tokens declared in an issue body."""
    if not body:
        return []
    tokens: list[str] = []
    for clause in DEPENDS_LINE.findall(body):
        if clause.strip().lower().strip(".") in NONE_WORDS:
            continue
        tokens += DEP_TOKEN.findall(clause)
    return tokens


def build_plan(epic: dict) -> dict:
    nodes = epic["subIssues"]["nodes"]

    by_dotted: dict[str, dict] = {}
    by_number: dict[int, dict] = {}
    items = []

    for node in nodes:
        match = TITLE_PREFIX.match(node["title"])
        dotted = match.group(1) if match else None
        labels = {label["name"] for label in node["labels"]["nodes"]}
        item = {
            "number": node["number"],
            "title": node["title"],
            "dotted": dotted,
            "state": node["state"],
            "kind": "story" if "story" in labels else "task",
            "raw_deps": parse_dependencies(node.get("body") or ""),
        }
        items.append(item)
        by_number[item["number"]] = item
        if dotted:
            by_dotted[dotted] = item

    # Resolve raw tokens to sibling issue numbers. A token is either a dotted
    # task id, a wildcard like "8.2.x" meaning every task under 8.2, or a bare
    # issue number. Anything that resolves outside this epic is recorded as an
    # external dependency rather than an ordering edge.
    for item in items:
        deps: set[int] = set()
        external: set[str] = set()
        for token in item["raw_deps"]:
            if token.endswith(".x"):
                prefix = token[:-2] + "."
                matched = [o for d, o in by_dotted.items() if d.startswith(prefix)]
                if matched:
                    deps.update(o["number"] for o in matched)
                else:
                    external.add(token)
                continue
            if token in by_dotted:
                deps.add(by_dotted[token]["number"])
                continue
            if "." not in token and int(token) in by_number:
                deps.add(int(token))
                continue
            external.add(token)
        deps.discard(item["number"])
        item["deps"] = sorted(deps)
        item["external_deps"] = sorted(external)

    # Kahn's algorithm, breaking ties by dotted order so the sequence matches
    # the numbering a human would expect.
    indegree = {i["number"]: 0 for i in items}
    dependents = defaultdict(list)
    for item in items:
        for dep in item["deps"]:
            if dep in indegree:
                indegree[item["number"]] += 1
                dependents[dep].append(item["number"])

    def tiebreak(number: int) -> tuple:
        item = by_number[number]
        return (dotted_key(item["dotted"]) if item["dotted"] else (999,), number)

    ready = sorted([n for n, d in indegree.items() if d == 0], key=tiebreak)
    order: list[int] = []
    while ready:
        current = ready.pop(0)
        order.append(current)
        for nxt in dependents[current]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                ready.append(nxt)
        ready.sort(key=tiebreak)

    cycle = [n for n, d in indegree.items() if d > 0]

    return {
        "epic": {"number": epic["number"], "title": epic["title"], "state": epic["state"]},
        "order": [by_number[n] for n in order],
        "cycle": [by_number[n] for n in cycle],
        "total": len(items),
        "done": sum(1 for i in items if i["state"] == "CLOSED"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("epic", type=int)
    ap.add_argument("--repo", default=None, help="owner/name (default: current repo)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    repo = args.repo
    if not repo:
        out = subprocess.run(
            ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            capture_output=True, text=True,
        )
        if out.returncode != 0:
            sys.exit("could not determine repo; pass --repo owner/name")
        repo = out.stdout.strip()
    owner, name = repo.split("/", 1)

    data = gh_graphql(SUB_ISSUES_QUERY, owner=owner, name=name, number=args.epic)
    epic = (data.get("data") or {}).get("repository", {}).get("issue")
    if not epic:
        sys.exit(f"issue #{args.epic} not found in {repo}")
    if epic["subIssues"]["totalCount"] == 0:
        sys.exit(f"#{args.epic} has no sub-issues — is it an epic?")

    plan = build_plan(epic)

    if args.json:
        print(json.dumps(plan, indent=2))
        return 1 if plan["cycle"] else 0

    e = plan["epic"]
    print(f"#{e['number']}  {e['title']}  [{e['state']}]")
    print(f"{plan['done']}/{plan['total']} sub-issues closed\n")

    closed = {i["number"] for i in plan["order"] if i["state"] == "CLOSED"}
    position = 0
    for item in plan["order"]:
        if item["state"] == "CLOSED":
            print(f"  ✓  #{item['number']:<4} {item['title'][:64]}")
            continue
        position += 1
        blockers = [d for d in item["deps"] if d not in closed]
        flags = []
        if blockers:
            flags.append("blocked by " + ", ".join(f"#{b}" for b in blockers))
        if item["external_deps"]:
            flags.append("external: " + ", ".join(item["external_deps"]))
        suffix = f"   ({'; '.join(flags)})" if flags else ""
        print(f"  {position:>2}. #{item['number']:<4} {item['title'][:64]}{suffix}")

    if plan["cycle"]:
        print("\n!! dependency cycle — resolve by hand before running the loop:")
        for item in plan["cycle"]:
            print(f"     #{item['number']} {item['title'][:60]}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
