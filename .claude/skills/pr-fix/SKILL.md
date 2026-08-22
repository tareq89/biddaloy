---
name: pr-fix
description: >
  Checks out an existing GitHub PR, rebases it on the base branch, reads
  every unresolved review comment, fixes the code, adds tests if needed,
  replies to each addressed comment, and pauses for confirmation before
  pushing. Trigger on: "fix PR #<n>", "address reviews on PR #<n>",
  "resolve feedback on <pr url>", or "/pr-fix <n>". Do not use for opening
  a brand-new PR, or for reviewing a PR without fixing it (use the
  code-review skill for that).
---

# PR Fix

Fixes review feedback on an existing PR end-to-end. Two hard pause points
(rebase conflicts, and before push) — never skip them, even if this skill
has run cleanly before.

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

If there is nothing unresolved: tell the user and stop here — don't
manufacture work.

Build a short plan before touching code: one line per unresolved thread,
file/line, and what change it implies. Show this to the user as you start,
so they can redirect early if you've misread a comment.

## 4. Rebase on the base branch

```bash
git fetch origin <base>
git rebase origin/<base>
```

**Pause point — conflicts.** If the rebase reports conflicts:
**stop immediately.** List the conflicting files, do not guess a
resolution (not even for "trivial-looking" conflicts like a lockfile).
Tell the user and wait for their instruction — either they resolve it
themselves and tell you to continue, or they tell you how to resolve each
one.

If the rebase is clean, continue.

## 5. Address each unresolved thread

Explore via the graph first, not raw grep: `graphify query "<question>"`
for a flagged file/symbol, `graphify path "<A>" "<B>"` for how two things
connect, `graphify explain "<concept>"` for one concept. Fall back to
`Read`/`Grep` only when the graph doesn't surface enough — see project
`CLAUDE.md`'s graphify rules.

For each thread from your step-3 plan: make the code change. Prefer one
commit per logically-related fix rather than one giant commit — it makes
the eventual review replies concrete ("fixed in `<sha>`") and makes the
diff easier for the human reviewer to re-review.

After code changes, run `graphify update .` before committing so the graph
stays current, and stage `graphify-out/` alongside the fix in the same
commit — never a separate trailing "regenerate graph" commit.

Never amend the PR's existing commits — everything here is new commits on
top.

## 6. Tests

Run the affected suite(s). In this repo:

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

CodeRabbit (or another bot reviewer) typically re-reviews automatically
once new commits land, which can produce fresh unresolved threads within
minutes of your push — including ones re-litigating a thread you already
replied to, if it ran before your push actually landed. This skill does
not loop on its own; if the user asks to check for or address further
review feedback after a push, repeat from step 3 (re-fetch threads — a
stale review-bot comment that ran against a pre-push commit is worth a
short reply pointing at the now-pushed SHA, not a code change) through
step 9, including a fresh pause-before-push confirmation.

## Scope notes

- This skill is generic (not Biddaloy-specific) — safe to copy to
  `~/.claude/skills/` if useful in other repos too.
- It fixes what reviewers already flagged. It does not go looking for
  additional unrelated changes to make while it's in there — stay scoped
  to the PR's actual feedback.
