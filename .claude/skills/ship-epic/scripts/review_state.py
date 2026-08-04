#!/usr/bin/env python3
"""Decide whether a PR's automated review has finished, or is merely quiet.

`review_threads.py open <pr>` returning zero threads is ambiguous: it means
"reviewed, found nothing" *or* "never reviewed". Merging on the second reading
skips review entirely, which in an unattended loop nobody would notice.

Three details make this easy to get wrong, and all three are load-bearing:

* **Bot login differs by API.** GraphQL reports ``coderabbitai``; REST reports
  ``coderabbitai[bot]``. A filter written for one silently matches nothing on
  the other.
* **The summary comment is edited in place, not reposted.** Observed on a real
  PR: ``created_at`` 14:46Z but ``updated_at`` 17:31Z. Judging silence by
  ``created_at`` would have reported nearly three hours of quiet nine minutes
  after the reviewer last wrote.
* **Findings and the summary live in different endpoints.** The summary is an
  issue comment; inline findings are pull-request review comments. Checking
  only one misses activity in the other.

Usage:
    review_state.py <pr> [--repo owner/name] [--quiet-minutes 30]

Exit codes:
    0  settled — reviewed, and quiet for the required window
    1  not settled yet — still within the quiet window
    2  rate limited — a review has not run; trigger one and wait
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone

BOT = re.compile(r"coderabbit", re.IGNORECASE)

# Rate-limit notices. Their presence means no review ran for the current head.
LIMITED = re.compile(r"review limit reached|next review available", re.IGNORECASE)

# Evidence that a review actually completed for the current head.
REVIEWED = re.compile(
    r"actionable comments posted|no actionable comments|## walkthrough|pre-merge checks",
    re.IGNORECASE,
)


def gh_json(path: str):
    out = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"gh api {path} failed: {out.stderr.strip()}")
    return json.loads(out.stdout or "[]")


def parse_ts(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pr", type=int)
    ap.add_argument("--repo", default=None, help="owner/name (default: current repo)")
    ap.add_argument("--quiet-minutes", type=int, default=30)
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

    issue_comments = gh_json(f"repos/{repo}/issues/{args.pr}/comments")
    review_comments = gh_json(f"repos/{repo}/pulls/{args.pr}/comments")

    stamps: list[datetime] = []
    bodies: list[str] = []
    for comment in list(issue_comments) + list(review_comments):
        if not BOT.search((comment.get("user") or {}).get("login", "")):
            continue
        bodies.append(comment.get("body") or "")
        # updated_at, not created_at — the summary comment is edited in place.
        stamps.append(parse_ts(comment["updated_at"]))

    if not stamps:
        print(f"#{args.pr}  no reviewer activity at all — a review has not started")
        return 2

    last = max(stamps)
    age = int((datetime.now(timezone.utc) - last).total_seconds() // 60)
    joined = "\n".join(bodies)
    limited = bool(LIMITED.search(joined))
    reviewed = bool(REVIEWED.search(joined))

    state = "rate-limited" if limited else ("reviewed" if reviewed else "unclear")
    print(f"#{args.pr}  {state}  last activity {age}m ago  (quiet window {args.quiet_minutes}m)")

    if limited:
        # Silence while rate limited is a queue, not an approval — however long
        # it has lasted.
        print("  -> a review has not run. Comment '@coderabbitai review' and wait.")
        return 2
    if not reviewed:
        print("  -> no completed-review marker found; treat as not reviewed.")
        return 2
    if age < args.quiet_minutes:
        print(f"  -> reviewed, but still settling; re-check in {args.quiet_minutes - age}m.")
        return 1

    print("  -> settled. review_threads.py now means what it says.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
