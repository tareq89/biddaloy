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
  rate-limited. Only the single most-recently-updated comment is meaningful —
  but see the next point for what "comment" has to mean here.
* **`issues/{pr}/comments` and `pulls/{pr}/comments` are not interchangeable
  evidence.** The first is where the one evolving PR-level summary lives
  (walkthrough, rate-limit notice, pre-merge checks). The second is
  per-line inline findings — individually authored by the bot, already
  tracked separately by ``review_threads.py``, and carrying no LIMITED or
  REVIEWED marker of their own. An earlier version of this script merged
  both into one pool and picked "the most recent comment" across all of
  them. Observed on PR #201: four inline finding replies had `updated_at`
  five seconds to six minutes *newer* than the actual summary comment
  (GitHub bumps a review comment's timestamp when its diff position goes
  stale, not just on content edits), so the newest-comment selection landed
  on an inline finding — with no marker at all — instead of the summary,
  which genuinely said the PR was clean. Status is decided from
  `issues/{pr}/comments` only; `pulls/{pr}/comments` counts only toward "did
  any reviewer activity happen at all".
* **A rate-limit notice is a static snapshot, not a live countdown.**
  Observed on PR #197: a comment posted at 20:25:14 UTC saying "next review
  in 40 minutes" still read exactly that at 21:56 — 91 minutes later,
  ``updated_at`` unchanged. CodeRabbit never revisits an old notice; only a
  *new* trigger (push or ``@coderabbitai review`` comment) produces a new
  one. Waiting past the stated window without retriggering waits forever.
  Conversely, retriggering *before* the window elapses just produces another
  rate-limit notice with a fresh, longer countdown — a wasted attempt.
* **The most-recently-updated comment is not always the informative one.**
  A manual ``@coderabbitai review`` trigger gets an immediate, near-contentless
  acknowledgment posted *after* the real summary comment it responds to —
  seen in three shapes: "Action performed / Review triggered.", "Action
  performed / Review finished.", and "Action not completed / Review rate
  limited." (this last one carries no countdown of its own; the actual
  minute figure lives in the fuller notice it responds to). Observed on PR
  #202: the rate-limit notice (``updated_at`` 23:05:52, "59 minutes"
  remaining) was two seconds older than its ack (23:05:54) — picking
  strictly by ``max(updated_at)`` selects the ack, which matches neither
  ``LIMITED`` nor ``REVIEWED``, and reports "unclear" for a PR that is
  unambiguously rate-limited. Falling back past *any* markerless comment
  is not safe either: "Currently processing..." also carries no marker but
  *is* the current, relevant state, and skipping past it risks resurrecting
  a stale rate-limit notice from an earlier, superseded trigger. Only skip
  comments matching the specific ack boilerplate above.
* **CodeRabbit's countdown is two separate bold spans, not one.** The real
  markdown is ``**Next review available in:** **59 minutes**`` — a closing
  bold, a space, then a *second* opening bold before the number. A regex
  written for one continuous bold run matches nothing against that, and
  silently fell through to the ``--quiet-minutes`` default (30) instead of
  raising an error — every "stated wait" this script reported before this
  fix was fabricated whenever a PR happened to hit this exact markdown
  shape, which was most of the time. Every comment body has its markdown
  emphasis stripped once, up front, rather than patching each regex to
  tolerate one more bold-span arrangement.

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
# No `\**` here — asterisks are stripped from every comment body before this
# ever runs (see the loop below), so this only has to match plain text.
WAIT_MINUTES = re.compile(r"next review available in:?\s*(\d+)\s*minutes?", re.IGNORECASE)

# Evidence that a review completed *at some point in this PR's history* —
# not necessarily for the current head. CodeRabbit edits one summary comment
# in place across the PR's whole lifetime and does not clear old sections, so
# a comment can contain a "Review limit reached" block from an early trigger
# attempt *and* a "## Walkthrough" / "Pre-merge checks" block from a later,
# successful one, both permanently. REVIEWED matching is therefore not by
# itself proof the review covers the latest push — see HEAD_COMMIT_RANGE.
REVIEWED = re.compile(
    r"actionable comments posted|no actionable comments|## walkthrough|pre-merge checks",
    re.IGNORECASE,
)

# "Reviewing files that changed from the base of the PR and between
# <sha1> and <sha2>." — <sha2> is the head commit the review actually covers.
# Comparing it against the PR's real head SHA is what makes REVIEWED
# trustworthy on a comment that accumulates history: a match proves this
# text describes the current push, not a stale walkthrough left over from
# before the latest commit.
HEAD_COMMIT_RANGE = re.compile(r"between\s+[0-9a-f]{7,40}\s+and\s+([0-9a-f]{7,40})", re.IGNORECASE)

# A manual-trigger acknowledgment carries no information about review state —
# it is not the same as "no marker yet because a review is still running" (a
# "Currently processing..." comment also has no LIMITED/REVIEWED marker, but
# *is* the current, relevant state and must not be skipped past). Only skip
# comments that specifically look like this boilerplate ack.
#
# "Action not completed / Review rate limited." is its own ack variant,
# observed on PR #202 — the trigger was rejected because a rate limit was
# already in effect. It carries no countdown of its own (the actual "N
# minutes" figure lives in the separate, older, fuller rate-limit notice this
# ack responds to), so it belongs here too: informative that *something*
# happened, but strictly less complete than the comment sitting next to it.
ACK_ONLY = re.compile(
    r"action performed|action not completed|review triggered|review finished|review rate limited",
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

    # These two endpoints are NOT interchangeable evidence of the same thing.
    # `issues/{pr}/comments` is where the walkthrough / rate-limit / pre-merge
    # summary lives — one evolving, PR-level status. `pulls/{pr}/comments` is
    # per-line inline findings, individually authored by the bot, each about
    # one specific code location — already tracked separately by
    # review_threads.py. Merging both into one "most recent comment" pool (an
    # earlier version of this script did exactly that) means an inline
    # finding reply — which carries no LIMITED/REVIEWED marker and can easily
    # have a newer `updated_at` than the actual summary — gets selected as
    # "the current status" over the real summary, misreporting a fully
    # reviewed-and-clean PR as unclear. Status is decided from issue-level
    # comments only; review-level comments only count toward "did any
    # reviewer activity happen at all".
    issue_bot_comments = [
        c for c in issue_comments if BOT.search((c.get("user") or {}).get("login", ""))
    ]
    any_bot_activity = issue_bot_comments or [
        c for c in review_comments if BOT.search((c.get("user") or {}).get("login", ""))
    ]
    # CodeRabbit's real markdown is two separate bold spans — literally
    # "**Next review available in:** **59 minutes**" — not one continuous
    # bold run. A regex written for a single span (`in:?\**\s*(\d+)`) matches
    # nothing against that, and every occurrence silently fell through to the
    # --quiet-minutes default (30) rather than raising an error, so the
    # mismatch went unnoticed until checked directly against a live PR.
    # Strip markdown emphasis before any pattern match, once, so no
    # regex — present or future — has to account for bold-span boundaries.
    for c in issue_bot_comments:
        c["body"] = re.sub(r"\*+", "", c.get("body") or "")

    if not any_bot_activity:
        print(f"#{args.pr}  no reviewer activity at all — a review has not started")
        print("  -> trigger required. Comment '@coderabbitai review'.")
        return 3
    if not issue_bot_comments:
        print(f"#{args.pr}  only inline finding comments exist, no PR-level summary yet")
        print("  -> treat as not reviewed. Trigger required.")
        return 3

    # The most-recently-updated comment is the one that matters — an older
    # comment sitting alongside it (a superseded rate-limit notice, say) is
    # not evidence about the current head. The one exception: a trigger's own
    # acknowledgment ("Action performed") can land newer than the real
    # summary it responds to, and carries no information of its own. Skip
    # *only* past comments that are specifically that boilerplate — not past
    # any markerless comment, since "Currently processing..." also has no
    # LIMITED/REVIEWED marker but *is* the current, relevant state, and
    # falling back further than that would wrongly resurrect a stale
    # rate-limit notice from an earlier, superseded trigger attempt.
    by_recency = sorted(issue_bot_comments, key=lambda c: parse_ts(c["updated_at"]), reverse=True)
    chosen = by_recency[0]
    for candidate in by_recency:
        if not ACK_ONLY.search(candidate.get("body") or ""):
            chosen = candidate
            break

    body = chosen.get("body") or ""
    posted_at = parse_ts(chosen["updated_at"])
    now = datetime.now(timezone.utc)
    age = int((now - posted_at).total_seconds() // 60)

    limited = bool(LIMITED.search(body))
    reviewed_raw = bool(REVIEWED.search(body))

    # A REVIEWED match is not proof by itself — the summary comment
    # accumulates history, so it can be true from an old, already-superseded
    # review while a stale "review limit reached" block from an even older
    # attempt also still sits in the same text. Confirm the reviewed content
    # actually names the PR's current head commit before trusting it.
    reviewed_fresh = False
    if reviewed_raw:
        range_match = HEAD_COMMIT_RANGE.search(body)
        if range_match is None:
            print(f"#{args.pr}  reviewed marker present but no commit range found — "
                  "cannot confirm it covers the current head; treating as not fresh.")
        else:
            head_out = subprocess.run(
                ["gh", "pr", "view", str(args.pr), "--repo", repo, "--json", "headRefOid",
                 "-q", ".headRefOid"],
                capture_output=True, text=True,
            )
            head_sha = head_out.stdout.strip().lower()
            reviewed_sha = range_match.group(1).lower()
            n = min(len(head_sha), len(reviewed_sha))
            reviewed_fresh = n > 0 and head_sha[:n] == reviewed_sha[:n]
            if not reviewed_fresh:
                print(f"#{args.pr}  reviewed marker covers {reviewed_sha[:7]}, "
                      f"current head is {head_sha[:7]} — stale, not the latest push.")

    if reviewed_fresh:
        print(f"#{args.pr}  reviewed  last update {age}m ago  (quiet window {args.quiet_minutes}m)")
    elif limited:
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
    else:
        print(f"#{args.pr}  unclear  latest bot comment ({age}m old) has no recognized, fresh marker")
        print("  -> treat as not reviewed. Trigger required.")
        return 3

    if age < args.quiet_minutes:
        print(f"  -> still settling; re-check in {args.quiet_minutes - age}m.")
        return 1

    print("  -> settled. review_threads.py now means what it says.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
