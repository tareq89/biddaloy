---
name: ship-issue
description: Take a biddaloy GitHub issue from backlog to merge-ready PR — pick the next eligible issue (or one the user names), plan it, implement it with tests, open the PR, and work the CodeRabbit review until nothing is outstanding. Use this whenever the user says "next ticket", "next issue", "work on #N", "implement issue N", "ship the next one", or asks to pick up backlog work in this repo, and also when they ask to handle or respond to CodeRabbit feedback on an existing PR. Stops for confirmation before merging.
---

# Ship an issue

Carry one issue from the backlog to a PR that a human only has to say "merge" to.

The work splits into five phases: pick, plan, build, review, hand off. The review
phase is the one people underestimate — a PR is not done when it's green, it's
done when every finding has been decided on.

The phases are a default path, not a rigid sequence. If the user points at an
existing PR and asks you to deal with its review comments, start at phase 4. If
they've already got a branch in progress, pick up wherever it stands.

## 1. Pick the issue

If the user named one (`#17`, "issue 17", "the bulk reminder one"), use it.

Otherwise find the next eligible issue:

```bash
gh issue list --state open --limit 100
```

Eligible means: not an epic (skip the `epic` label), not blocked by an open
dependency, and lowest phase number first — issues are titled `[N.M] Name` and
the numbering is the intended order. Prefer `priority-critical` when several sit
in the same phase.

Read it fully before starting, and check whether it's already partly built:

```bash
gh issue view <n>
```

Confirm the choice with the user before writing code when you picked it
yourself. Getting three phases deep into the wrong ticket wastes far more time
than one question.

## 2. Plan

Read `references/repo-conventions.md` now — it covers layout, the guard stack,
tenant scoping, migrations, and test patterns. Matching the existing grain is
most of what makes a PR reviewable.

Explore before designing. Issues are written from the product side and often
assume things the code has already solved, or name specific vendors/libraries
where a better fit exists. Look for:

- Entities, enums, or tables that already exist for this feature. Phase-0 laid
  down schema for work that lands much later — check `shared/src/enums/` and the
  initial migration before creating anything.
- The closest existing module to copy structure from.
- Whether the issue's literal instructions still make sense. Deviating is fine
  when there's a better answer; say so explicitly and put the reasoning in the
  PR's Notes section.

Surface material choices to the user before building — vendor swaps, new
infrastructure, anything that changes the deployment story. Routine judgment
calls are yours to make.

Then branch off fresh `origin/main` (local `main` is often stale):

```bash
git fetch origin main
git checkout -b feature-<N.M> origin/main
git branch --unset-upstream
```

The branch name mirrors the issue's bracket prefix: `[4.1] Communication
Service` → `feature-4.1`.

## 3. Build

Track the work with the task tools — these tickets run 10+ steps and a visible
list is how the user follows along.

Write the feature and its tests together, not tests as an afterthought. Target
**95% coverage on the code this PR adds**; leave the repo's global thresholds in
`vitest.config.ts` alone, since existing modules were written against lower bars
and raising them breaks unrelated builds.

Check coverage on your new files specifically:

```bash
yarn test:cov
```

Coverage is a floor, not the goal. 95% of lines executed with no assertion about
behavior is worthless. Aim tests at the branches that encode real decisions —
error paths, tenant boundaries, retry logic, anything with a conditional. If a
branch is genuinely untestable without heavy mocking, that's often the code
asking to be restructured.

Verify before committing:

```bash
yarn build      # nest build
yarn lint       # tsc --noEmit
yarn test:unit
```

**Exercise anything that touches infrastructure for real.** Unit tests won't
catch a migration that fails on production-shaped data, a module that can't
resolve its dependencies, or a queue that never connects. Spin up Docker
Postgres/Redis, run the migrations, boot the server, hit the endpoint. When
testing a migration, seed the awkward row first — an empty table makes every
backfill look correct. `references/repo-conventions.md` has the details.

`AGENTS.md` asks for `graphify . --update` before each commit. If it fails for
want of an API key, tell the user rather than running `--code-only` on their
behalf — that reindexes docs without semantic extraction and is their call.

Commit conventionally with a body explaining *why*, push, and open the PR with
the structure in `references/repo-conventions.md`, including `Closes #<issue>`.

## 4. Work the review

CodeRabbit reviews automatically and takes a few minutes. Wait for it rather
than polling in a tight loop:

```bash
gh pr checks <pr>
```

Then inspect the threads with the bundled script:

```bash
python3 .claude/skills/ship-issue/scripts/review_threads.py open <pr>
```

Use this script rather than `gh api .../pulls/N/comments`. The REST endpoint
does not expose whether a thread is resolved, so it cannot distinguish "already
handled" from "still open" — and `gh pr checks` showing `pass` only means the
review *ran*, not that its findings were addressed. Checking the wrong way is
how a critical finding gets merged past.

For each finding, decide: **fix**, **push back**, or **defer**. Read
`references/review-triage.md` before your first pass — it covers how to make
that call and has worked examples of all three from PR #55.

Verify a finding still applies before acting on it, and reproduce anything that
claims runtime or data behavior. Then reply, and resolve where appropriate:

```bash
# fixed, or confidently wrong — reply and close it out
python3 .claude/skills/ship-issue/scripts/review_threads.py reply-resolve <pr> <thread-id> <<'EOF'
Fixed in <sha> — <what changed and why>.
EOF

# judgment call a maintainer should rule on — reply, leave open
python3 .claude/skills/ship-issue/scripts/review_threads.py reply <pr> <thread-id> <<'EOF'
Deferring deliberately — <reasoning>. Flagging for a maintainer call.
EOF
```

Push fixes as a follow-up commit; CodeRabbit re-reviews on push. **Loop until a
pass produces no new findings** — fixes routinely surface new ones, and that's
the loop working, not failing. In PR #55 the fixup commit introduced a critical
migration bug that only the second pass caught.

Stop looping when the only open threads are deliberate deferrals. If you find
yourself going back and forth on the same finding twice, that's a sign it needs
a human, not a third attempt.

## 5. Hand off

Do not merge. Report back with:

- What shipped, and any deviation from the issue as written.
- Verification actually run — build, lint, test counts, coverage on new code,
  what you exercised against real infrastructure.
- Findings fixed, and findings you pushed back on with the reasoning.
- **Anything still open**, called out plainly, with your recommendation.
- Anything you couldn't complete, and why.

Then ask whether to merge. Merging is effectively irreversible on a shared
branch, and the last check is exactly where the worst bug in PR #55 surfaced —
that's the moment to have a human in the loop, not to save a round trip.

On approval:

```bash
gh pr merge <pr> --merge     # merge commit, matching repo history
```

Afterward, confirm the merge landed, the issue auto-closed via `Closes #N`, and
sync local `main`.

## Honesty about state

Report what actually happened. If tests fail, say so with the output. If you
skipped a step — the graphify update, an integration run that needed
credentials — say that plainly rather than letting "done" imply it. A PR
described accurately is worth more than one described well, because the user is
deciding whether to merge based on what you tell them.
