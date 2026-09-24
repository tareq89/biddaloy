---
name: pr-fix
description: >
  Checks out an existing GitHub PR into an isolated worktree, rebases it on
  the base branch, reads every unresolved review comment AND every failing
  CI check, plans the fix with an Opus-high subagent, fixes both in one
  batched pass, adds tests if needed, runs an Opus-high review pass that
  predicts and fixes other tests/CI the change could break, replies to each
  addressed comment, and pauses for confirmation before a single push.
  Trigger on: "fix PR #<n>", "address reviews on PR #<n>", "fix CI on PR
  #<n>", "resolve feedback on <pr url>", or "/pr-fix <n>". Do not use for
  opening a brand-new PR, or for reviewing a PR without fixing it (use the
  code-review skill for that).
---

# PR Fix

Fixes review feedback AND failing CI on an existing PR end-to-end, in one
batched pass ending in a single push. Runs in its own git worktree, plans
and reviews via Opus-high subagents, and loops on newly-broken tests until
green. Three hard pause points (rebase conflicts, plan review, and before
push) — never skip them, even if this skill has run cleanly before.

**Batch, don't drip-feed.** Diagnose everything first — every unresolved
review thread and every failing CI check — before fixing anything. Fix it
all. Run the affected test suite(s) once. Push once. The failure mode this
guards against: fixing one thing, running the full suite, pushing, waiting
7-15 minutes for CI, finding the next thing, and repeating — which multiplies
the CI/test round-trip cost by however many separate issues there were,
instead of paying it once. The one exception is a fix you're genuinely
unsure about (touches locking, concurrency, money-tier correctness, or
anything a reviewer flagged as subtle) — give that one its own commit, and if
it's truly risky, its own isolated verification run, rather than burying it
in a batch of mechanical fixes where a regression is hard to attribute back
to the right change.

## 0. Setup

```bash
/caveman wenyan-ultra
```

Sets tone for the rest of this skill's run.

## 1. Preflight

```bash
git status --short
```

If not clean: **stop**, tell the user, do not stash or discard anything.
This skill only ever operates on a clean tree.

## 2. Checkout the PR into an isolated worktree

Never fix a PR in-place on the main working tree — always in a dedicated
worktree, so the user's own working tree stays untouched and multiple
`pr-fix` runs can't collide.

```bash
gh pr view <n> --json baseRefName,headRefName,url -q '{base: .baseRefName, head: .headRefName, url: .url}'
gh repo view --json owner,name -q '{owner: .owner.login, repo: .name}'
git fetch origin <head>
git worktree add ../pr-<n>-fix origin/<head> -B <head>
cd ../pr-<n>-fix
```

Do all remaining work from inside `../pr-<n>-fix`. Once checkout succeeds,
refresh the graph so later exploration reflects this PR's actual code, not
a stale graph from a prior session or branch:

```bash
/graphify update .
```

(AST-only, no API cost.)

When the run finishes (pushed, or the user calls it off), remove the
worktree:

```bash
git worktree remove ../pr-<n>-fix
```

## 3. Fetch unresolved review feedback

Inline review comments only show as "resolved" via GraphQL — the REST API
doesn't expose it, so use this query (substitute `$owner`/`$repo`/`$pr`):

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 50) {
            nodes { databaseId body path line author { login } }
          }
        }
      }
    }
  }
}' -f owner="$OWNER" -f repo="$REPO" -F pr=<n>
```

Filter to `isResolved: false`. Also pull top-level review summary comments
(not tied to a line) which the GraphQL query above won't include:

```bash
gh pr view <n> --json reviews -q '.reviews[] | select(.body != "") | {author: .author.login, body: .body}'
```

## 3b. Fetch CI status

```bash
gh pr checks <n>
```

For every failing check, pull its actual log rather than guessing from the
job name:

```bash
gh run view <run-id> --log-failed
```

For each failure, before writing any fix, determine whether it's caused by
this PR's own changes or is a pre-existing flake unrelated to them. When
unsure, reproduce it in isolation a few times (re-run just that failing
test/job) — a failure that reproduces consistently and touches files this PR
changed is real; one that passes on a clean re-run, or fails on files this PR
never touched, is a flake. Root-cause and fix a real pre-existing flake too
when it's cheap to do (a "flaky" test is often a real, if minor, bug — e.g.
code relying on an unordered SQL read for a required order — not pure bad
luck); if it's expensive or ambiguous, say explicitly that it's pre-existing
and leave it alone rather than silently re-running until it happens to pass.

If there is nothing unresolved and CI is green: tell the user and stop
here — don't manufacture work.

## 3c. Plan (Opus-high subagent)

Dispatch a subagent (model: Opus, effort: high) with:
- Every unresolved review thread from step 3.
- Every real CI failure from step 3b, with logs.
- Instruction to run in `/caveman wenyan-ultra` too (subagents don't
  inherit the parent's mode).

Ask it to return a combined plan: one line per unresolved review thread and
one per real CI failure, each with file/line and the exact change it
implies. It plans only — it does not edit code.

Show this plan to the user before touching code, so they can redirect early
if the subagent misread a comment or a failure.

## 4. Rebase on the base branch

```bash
git fetch origin <base>
git rebase origin/<base>
```

**Pause point — conflicts.** If the rebase reports conflicts:
**stop immediately.** List the conflicting files, do not guess a
resolution (not even for "trivial-looking" conflicts like a lockfile) —
this repo has a documented history of exactly that going wrong (blind
`--ours` on a spec file once silently reintroduced a broken duplicate
`describe` block). Tell the user and wait for their instruction — either
they resolve it themselves and tell you to continue, or they tell you how
to resolve each one. Once conflicts are resolved, continue in the same
run — resolving a conflict doesn't reset the "one batched pass, one push"
goal, it's just the one step here that needs a human call before the batch
can be assembled.

If the rebase is clean, continue straight into fixing review threads and
CI failures together.

## 5. Address every review thread and every real CI failure

Follow the plan from step 3c. Explore via the graph first, not raw grep:
`graphify query "<question>"` for a flagged file/symbol, `graphify path
"<A>" "<B>"` for how two things connect, `graphify explain "<concept>"` for
one concept. Fall back to `Read`/`Grep` only when the graph doesn't surface
enough — see project `CLAUDE.md`'s graphify rules.

Work through the plan in one pass — do not run tests or push between
individual fixes. Prefer one commit per logically-related fix rather than
one giant commit — it makes the eventual review replies concrete ("fixed in
`<sha>`") and makes the diff easier for the human reviewer to re-review,
and it keeps a risky fix (see the batching note above) attributable on its
own if it turns out to be wrong.

After code changes, run `graphify update .` so the graph stays current for
later exploration. Do not stage its output: the generated files under
`graphify-out/` were untracked on 2026-08-29, so there is nothing to commit
and no "regenerate graph" commit to make. (`README.md` and `cost.json` there
stay tracked, and `graphify update .` does not touch them.)

Never amend the PR's existing commits — everything here is new commits on
top.

## 6. Review (Opus-high subagent) — predict what else the fix could break

Once step 5's fixes are made (before running tests), dispatch a second
subagent (model: Opus, effort: high, `/caveman wenyan-ultra`) with:
- The full pr-fix context: the plan from 3c, the diff produced by step 5
  (`git diff origin/<base>...HEAD`), and which files/tests were touched.

Ask it for two things:
1. A review of the fixes themselves against the plan and the original
   feedback/failures (same bar as the `code-review` skill).
2. A prediction of what *other* tests — beyond the ones that were already
   failing — this change is likely to affect (e.g. shared helpers,
   callers of a changed function, fixtures touching the same table).

For anything it flags as an easy fix, fix it now, in this same pass. For
anything non-trivial or uncertain, don't guess — list it for the
pause-before-push summary (step 9) instead of silently editing.

## 7. Tests — run once, then loop only on newly-broken ones

Run the affected suite(s) **once**, after all fixes from steps 5 and 6 are
done — not once per individual fix. Include the tests predicted in step 6
alongside the tests tied to the original failures/threads. In this repo:

```bash
rtk yarn test              # server
rtk yarn test:frontend --run   # ui / client-admin / client-student
```

If a reviewer explicitly asked for test coverage, or your fix touches
logic that this repo's own testing rules would require coverage for
(see `server/CLAUDE.md`), add the test as part of the same commit as the
fix it covers, not a separate trailing commit.

**Loop:** if any predicted-affected test fails, go back to the Opus-high
plan subagent (step 3c) with the new failure(s), get an updated plan, apply
the fix (step 5), and re-run the tests (this step). Repeat until every
test — original and predicted-affected — is green. Don't weaken or delete a
test to end the loop.

## 8. Check other CI processes, not just tests

Tests are one CI job among several. Before committing/pushing, check what
else this repo's CI runs (lint, typecheck, build, `check-api-types`,
Storybook build, etc. — see `.github/workflows/` for the actual list) and
run the ones your changes could plausibly affect:

```bash
rtk yarn lint
rtk tsc
rtk yarn build
```

Fix anything that breaks, as part of this same batched pass, before moving
to the push pause point. If a check is expensive (e.g. full e2e) and your
change is clearly unrelated to it, say so explicitly rather than running it
speculatively.

## 9. Reply to each addressed thread

For every thread you fixed, post a reply referencing the commit:

```bash
gh api repos/$OWNER/$REPO/pulls/<n>/comments \
  --method POST \
  -f body="Addressed in <short-sha>: <one-line description of the fix>" \
  -F in_reply_to=<databaseId of the original comment>
```

Do this for every addressed thread. Do **not** mark threads as resolved on
GitHub — resolving is the reviewer's call, not the author's; a reply
referencing the fixing commit is enough for them to do that themselves.

If a comment turned out to be something you're not going to act on (e.g.
it's already stale, or you disagree), do not silently skip it — reply
explaining why, and flag it to the user rather than deciding alone.

## 10. Pause point — before push

Before pushing, show the user:
- The list of new commits (`git log origin/<head>..HEAD --oneline`, or
  since the rebase moved things, `git log --oneline <n-of-new-commits>`).
- Test results (green), including which predicted-affected tests were run
  and whether the loop in step 7 fired.
- Results of the other CI checks from step 8.
- The step 6 review findings: what was fixed as "easy", and what was left
  for the user because it was non-trivial or uncertain.
- Which threads were addressed and replied to, and which (if any) were
  skipped with an explanation.
- Which CI failures were fixed, and which (if any) were root-caused as
  pre-existing flakes and left alone, with why.

**Wait for explicit confirmation.** Do not push automatically just because
everything above succeeded.

## 11. Push

Once confirmed:

```bash
git push --force-with-lease
```

Never plain `--force`. `--force-with-lease` refuses the push if someone
else has pushed to this branch since you last fetched it — exactly the
protection you want after a rebase, since it fails loudly instead of
silently overwriting someone else's concurrent work on the same PR branch.

Once the push succeeds, clean up the worktree (see step 2) unless the user
wants to keep it around for a follow-up.

## 12. If the push is rejected

`--force-with-lease` fails (often as "stale info" rather than a normal
rejection) whenever the remote branch has moved since your last fetch —
**stop and investigate before retrying anything.** Do not re-run the same
push, and do not fall back to plain `--force`.

```bash
git fetch origin <head>
git log --oneline -1 origin/<head>
```

Figure out whether the remote moved for a benign reason or a real
conflict:

```bash
gh api repos/$OWNER/$REPO/commits/<new-remote-sha> \
  -q '{author: .author.login, committer_date: .commit.committer.date, msg: .commit.message}'
gh api repos/$OWNER/$REPO/events -q '.[] | select(.type=="PushEvent") | {actor: .actor.login, at: .created_at}'
```

- **Same author, and the commit content is a rebase of the branch you
  already know about** (e.g. identical commit messages/diffs onto a newer
  base, a committer date matching a `PushEvent` timestamp you can see) —
  this is the PR author updating the branch elsewhere (another session, a
  manual rebase, a "update branch" click). Treat it like any other
  upstream move: `git rebase origin/<head>`, re-run tests (step 7), and
  push again. This is the same conflict-pause discipline as step 4 — if
  the rebase reports conflicts, stop and ask rather than resolving blind.
- **Different author, or content you don't recognize** — stop, show the
  user what changed on the remote tip, and ask how to proceed. Never
  rebase over or discard someone else's unrelated work without asking.

## 13. Re-checking after a push (only if asked)

CI re-runs and CodeRabbit (or another bot reviewer) typically re-reviews
automatically once new commits land, which can produce fresh failures or
unresolved threads within minutes of your push — including ones
re-litigating a thread you already replied to, if the bot ran before your
push actually landed. This skill does not loop on its own; if the user asks
to check for or address further feedback after a push, wait for CI to
actually finish (don't diagnose a still-running job as failed), then repeat
from step 3/3b (re-fetch threads and checks together — a stale review-bot
comment that ran against a pre-push commit is worth a short reply pointing
at the now-pushed SHA, not a code change) through step 11, batching whatever
is newly found the same way as the first pass, including a fresh
pause-before-push confirmation.

## Scope notes

- This skill is generic (not SchoolManager-specific) — safe to copy to
  `~/.claude/skills/` if useful in other repos too.
- It fixes what reviewers already flagged and what CI already failed on,
  plus what step 6's review predicts is likely to break as a direct
  consequence of the fix. It does not go looking for additional unrelated
  changes to make while it's in there — stay scoped to the PR's actual
  feedback, failures, and their direct fallout.
