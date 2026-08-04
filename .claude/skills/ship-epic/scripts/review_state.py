#!/usr/bin/env python3
"""Decide whether a PR's automated review has finished, or is merely quiet.

`review_threads.py open <pr>` returning zero threads is ambiguous: it means
"reviewed, found nothing" *or* "never reviewed". Merging on the second reading
skips review entirely, which in an unattended loop nobody would notice.

Four details make this easy to get wrong, and all four are load-bearing —
each was hit for real running epic 8.1, not anticipated in the abstract:

* **Bot login differs by API.** GraphQL reports ``coderabbitai``; REST reports
  ``coderabbitai[bot]``. A filter written for one silently matches nothing on
  the other.
* **The summary comment is edited in place, not reposted** — usually. Observed
  on PR #196: ``created_at`` 14:46Z but ``updated_at`` 17:31Z. Judging silence
  by ``created_at`` would have reported nearly three hours of quiet nine
  minutes after the reviewer last wrote.
* **CodeRabbit can also post more than one comment for the same PR** — a
  rate-limit notice and a real walkthrough coexisting, from different trigger
  attempts. Concatenating every bot comment's text and searching the joined
  string (an earlier version of this script did exactly that) means a stale
  rate-limit body sitting next to a fresh clean review still reads as
  rate-limited. Only the single most-recently-updated comment is meaningful.
* **A rate-limit notice is a static snapshot, not a live countdown.**
  Observed on PR #197: a comment posted at 20:25:14 UTC saying "next review
  in 40 minutes" still read exactly that at 21:56 — 91 minutes later,
  ``updated_at`` unchanged. CodeRabbit never revisits an old notice; only a
  *new* trigger (push or ``@coderabbitai review`` comment) produces a new
  one. Waiting past the stated window without retriggering waits forever.
  Conversely, retriggering *before* the window elapses just produces another
  rate-limit notice with a fresh, longer countdown — a wasted attempt.

Usage:
    review_state.py <pr> [--repo owner/name] [--quiet-minutes 30]

Exit codes:
    0  settled          — reviewed, and quiet for the required window. Safe.
    1  still settling    — reviewed, but within the quiet window. Re-check later.
    2  wait              — rate limited, stated window has not elapsed. Do not
                            trigger; it will just extend the countdown.
    3  trigger required  — rate limited and the window has elapsed, or no
                            review has ever run. Passive waiting will not
                            resolve this; post '@coderabbitai review'.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

BOT = re.compile(r"coderabbit", re.IGNORECASE)

LIMITED = re.compile(r"review limit reached|next review available", re.IGNORECASE)
WAIT_MINUTES = re.compile(r"next review available in:?\**\s*(\d+)\s*minutes?", re.IGNORECASE)

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

    bot_comments = [
        c for c in list(issue_comments) + list(review_comments)
        if BOT.search((c.get("user") or {}).get("login", ""))
    ]

    if not bot_comments:
        print(f"#{args.pr}  no reviewer activity at all — a review has not started")
        print("  -> trigger required. Comment '@coderabbitai review'.")
        return 3

    # Only the single most-recently-updated comment is meaningful. An older
    # comment sitting alongside it — a superseded rate-limit notice, say — is
    # not evidence of anything about the current head.
    latest = max(bot_comments, key=lambda c: parse_ts(c["updated_at"]))
    body = latest.get("body") or ""
    posted_at = parse_ts(latest["updated_at"])
    now = datetime.now(timezone.utc)
    age = int((now - posted_at).total_seconds() // 60)

    limited = bool(LIMITED.search(body))
    reviewed = bool(REVIEWED.search(body))

    if limited:
        wait_match = WAIT_MINUTES.search(body)
        stated_wait = int(wait_match.group(1)) if wait_match else args.quiet_minutes
        elapsed_since_stated = (now - (posted_at + timedelta(minutes=stated_wait))).total_seconds() / 60

        print(f"#{args.pr}  rate-limited  notice posted {age}m ago, stated wait {stated_wait}m")
        if elapsed_since_stated >= 0:
            print(f"  -> stated window elapsed {elapsed_since_stated:.0f}m ago. This notice will "
                  "never update on its own — trigger required. Comment '@coderabbitai review'.")
            return 3
        print(f"  -> still within the stated window ({-elapsed_since_stated:.0f}m remaining). "
              "Wait — retriggering now would just extend the countdown.")
        return 2

    if not reviewed:
        print(f"#{args.pr}  unclear  latest bot comment ({age}m old) has no recognized marker")
        print("  -> treat as not reviewed. Trigger required.")
        return 3

    print(f"#{args.pr}  reviewed  last update {age}m ago  (quiet window {args.quiet_minutes}m)")
    if age < args.quiet_minutes:
        print(f"  -> still settling; re-check in {args.quiet_minutes - age}m.")
        return 1

    print("  -> settled. review_threads.py now means what it says.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
