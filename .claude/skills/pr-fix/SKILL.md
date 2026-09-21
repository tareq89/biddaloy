---
name: pr-fix
description: >
  Checks out an existing GitHub PR, rebases it on the base branch, reads
  every unresolved review comment AND every failing CI check, fixes both in
  one batched pass, adds tests if needed, replies to each addressed comment,
  and pauses for confirmation before a single push. Trigger on: "fix PR
  #<n>", "address reviews on PR #<n>", "fix CI on PR #<n>", "resolve
  feedback on <pr url>", or "/pr-fix <n>". Do not use for opening a
  brand-new PR, or for reviewing a PR without fixing it (use the
  code-review skill for that).
---

# PR Fix

Fixes review feedback AND failing CI on an existing PR end-to-end, in one
batched pass ending in a single push. Two hard pause points (rebase
conflicts, and before push) — never skip them, even if this skill has run
cleanly before.

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

## 2. Checkout the PR

```bash
gh pr checkout <n>
```

`gh pr checkout` (not `git checkout`) — it correctly sets up the branch
whether the PR is from the same repo or a fork.

Get the PR's base branch and repo coordinates, needed for later steps:

```bash
gh pr view <n> --json baseRefName,headRefName,url -q '{base: .baseRefName, head: .headRefName, url: .url}'
gh repo view --json owner,name -q '{owner: .owner.login, repo: .name}'
```

Once checkout succeeds, refresh the graph so later exploration reflects
this PR's actual code, not a stale graph from a prior session or branch:

```bash
/graphify update .
```

(AST-only, no API cost.)

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

Build a short combined plan before touching code: one line per unresolved
review thread and one per real CI failure, file/line, and what change it
implies. Show this to the user as you start, so they can redirect early if
you've misread a comment or a failure.

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

Explore via the graph first, not raw grep: `graphify query "<question>"`
for a flagged file/symbol, `graphify path "<A>" "<B>"` for how two things
connect, `graphify explain "<concept>"` for one concept. Fall back to
`Read`/`Grep` only when the graph doesn't surface enough — see project
`CLAUDE.md`'s graphify rules.

Work through your combined plan from steps 3 and 3b in one pass — do not
run tests or push between individual fixes. Prefer one commit per
logically-related fix rather than one giant commit — it makes the eventual
review replies concrete ("fixed in `<sha>`") and makes the diff easier for
the human reviewer to re-review, and it keeps a risky fix (see the batching
note above) attributable on its own if it turns out to be wrong.

After code changes, run `graphify update .` so the graph stays current for
later exploration. Do not stage its output: the generated files under
`graphify-out/` were untracked on 2026-08-29, so there is nothing to commit
and no "regenerate graph" commit to make. (`README.md` and `cost.json` there
stay tracked, and `graphify update .` does not touch them.)

Never amend the PR's existing commits — everything here is new commits on
top.

## 6. Tests — run once, after every fix is made

Run the affected suite(s) **once**, after all fixes from step 5 are done —
not once per individual fix. In this repo:

```bash
rtk yarn test              # server
rtk yarn test:frontend --run   # ui / client-admin / client-student
```

If a reviewer explicitly asked for test coverage, or your fix touches
logic that this repo's own testing rules would require coverage for
(see `server/CLAUDE.md`), add the test as part of the same commit as the
fix it covers, not a separate trailing commit.

All tests must be green before moving on. If you cannot make a test pass,
**stop and tell the user** rather than weakening or deleting the test to
make it pass.

## 7. Reply to each addressed thread

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

## 8. Pause point — before push

Before pushing, show the user:
- The list of new commits (`git log origin/<head>..HEAD --oneline`, or
  since the rebase moved things, `git log --oneline <n-of-new-commits>`).
- Test results (green).
- Which threads were addressed and replied to, and which (if any) were
  skipped with an explanation.
- Which CI failures were fixed, and which (if any) were root-caused as
  pre-existing flakes and left alone, with why.

**Wait for explicit confirmation.** Do not push automatically just because
everything above succeeded.

## 9. Push

Once confirmed:

```bash
git push --force-with-lease
```

Never plain `--force`. `--force-with-lease` refuses the push if someone
else has pushed to this branch since you last fetched it — exactly the
protection you want after a rebase, since it fails loudly instead of
silently overwriting someone else's concurrent work on the same PR branch.

## 10. If the push is rejected

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
  upstream move: `git rebase origin/<head>`, re-run tests (step 6), and
  push again. This is the same conflict-pause discipline as step 4 — if
  the rebase reports conflicts, stop and ask rather than resolving blind.
- **Different author, or content you don't recognize** — stop, show the
  user what changed on the remote tip, and ask how to proceed. Never
  rebase over or discard someone else's unrelated work without asking.

## 11. Re-checking after a push (only if asked)

CI re-runs and CodeRabbit (or another bot reviewer) typically re-reviews
automatically once new commits land, which can produce fresh failures or
unresolved threads within minutes of your push — including ones
re-litigating a thread you already replied to, if the bot ran before your
push actually landed. This skill does not loop on its own; if the user asks
to check for or address further feedback after a push, wait for CI to
actually finish (don't diagnose a still-running job as failed), then repeat
from step 3/3b (re-fetch threads and checks together — a stale review-bot
comment that ran against a pre-push commit is worth a short reply pointing
at the now-pushed SHA, not a code change) through step 9, batching whatever
is newly found the same way as the first pass, including a fresh
pause-before-push confirmation.

## Scope notes

- This skill is generic (not SchoolManager-specific) — safe to copy to
  `~/.claude/skills/` if useful in other repos too.
- It fixes what reviewers already flagged and what CI already failed on.
  It does not go looking for additional unrelated changes to make while
  it's in there — stay scoped to the PR's actual feedback and failures.
