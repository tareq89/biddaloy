---
name: implement-issue
description: Implement one issue, or a batch of issues, end-to-end as a chain of stacked branches and PRs — one issue at a time — with graphify-driven codebase research, a written plan per issue, tests and Storybook stories, and CodeRabbit-safe PR pacing. Use this whenever the user invokes /implement-issue, gives an issue number, ID, or link, or hands over a list of issues (or an epic to expand into its issues) and asks to work through them, implement them, or ship them one by one. Also use when the user asks to resume a partially-finished run.
---

# Implement Issue

Work an issue — or a queue of them — to completion: one branch, one PR, one
review cycle per issue, chained in order.

For a single issue this is just a disciplined loop. For a queue it becomes a
**long** run, often 7+ hours because of PR pacing, and very likely interrupted
by usage limits. Everything below is designed so that a fresh session can pick
up exactly where the last one stopped without redoing work or losing the thread.

## Invocation

```
/implement-issue 99
/implement-issue 8.10.1 8.10.2 8.10.3
/implement-issue https://tracker/…/PROJ-441 https://tracker/…/PROJ-442
/implement-issue epic 892
/implement-issue resume
```

Accepted input:

- **A single issue ID/number/link** → work that one issue and stop.
- **A list of issue IDs, numbers, or links** → work them in the order given.
- **An epic ID/number/link** → resolve its child issues into an ordered queue,
  then work them in order.
- **`resume`** (or no argument, when a state file exists) → read the state file
  and continue.

## Mode

Run the entire session in `/caveman wenyan-ultra` mode so input and output
tokens stay minimal. Invoke it at the start if it isn't already active.

This governs **your conversational output**, not the artifacts. Code, tests,
stories, commit messages, PR descriptions, and the per-issue plans must stay
normal, complete, and readable — a compressed plan defeats its own purpose,
since the user needs to be able to review it.

## Step 0 — Resolve the work

1. Detect the issue source from what's available: a tracker MCP server, `gh`,
   a Jira/Linear CLI, or an issues directory in the repo. Use whichever is
   present rather than assuming.
2. If given an epic, fetch it and list its child issues in dependency order. If
   the tracker gives no explicit order, sort by issue number (`8.10.1` before
   `8.10.2`) and say so.
3. Print the resolved queue and the branch chain, then start. Only stop to ask
   if the queue is empty, the issue can't be found, or two issues obviously
   conflict over the same files in a way the ordering doesn't resolve.

## Step 1 — Write the state file

Before touching any code, write `.implement-issue-state.md` at the repo root
(gitignored — add it to `.git/info/exclude` if it isn't already):

```markdown
# Queue: 8.10.1, 8.10.2, 8.10.3, ...
Base: main
Source: <epic 892 / explicit list>

## 8.10.1 — <title>
Branch: feat/8.10.1-<slug>  |  Base: main
Status: done
PR: #123 opened 2026-08-22T09:14Z

## 8.10.2 — <title>
Branch: feat/8.10.2-<slug>  |  Base: feat/8.10.1-<slug>
Status: in-progress — step 4 (tests written, stories pending)
PR: —
```

Update it after **every** completed step, not just every issue. Statuses:
`pending`, `planning`, `in-progress — step N`, `pushed`, `pr-open`, `done`.

This file is the resume contract. If a session dies mid-issue, the next one
reads this plus `git status` and `git log` to reconstruct position exactly.
Write it even for a single issue — that's the run most likely to be treated as
"too short to bother", and it's the one where a mid-implementation compaction
loses everything.

## Step 2 — Per-issue loop

Repeat for each issue, strictly in order. Never begin issue N+1's
implementation before issue N's PR is open.

### 1. Branch

- The first issue branches from `main`.
- Every later issue branches from the **previous issue's branch**, and its PR
  targets that branch — stacked PRs, not N separate PRs into `main`.
- If an earlier PR gets merged to `main` mid-run, rebase the remaining chain
  onto `main` and retarget the open PRs rather than leaving them stacked on a
  merged branch.

### 2. Research with graphify

Use graphify to find the call sites, dependents, and existing patterns that this
issue touches — before forming any opinion about the implementation. Grepping
blind wastes tokens and misses indirect dependents, which is exactly the failure
mode graphify exists to prevent.

### 3. Plan

Write a detailed plan before any code:

```markdown
## Plan — <issue id>
**Goal:** what "done" means, in one or two sentences
**Touched:** files/modules, from graphify
**Approach:** the actual steps
**Backend:** NestJS changes needed, or "none"
**UI:** which biddaloy design-system components/tokens
**Tests:** what gets covered, at what level
**Stories:** which Storybook stories, which states
**Risks:** anything that could break dependents
```

Save it to the state file. If the plan reveals the issue is much bigger than it
looked, say so before starting rather than after.

### 4. Implement

- Follow the plan. If reality diverges, update the plan first.
- Backend work belongs in the **NestJS project as part of the same issue** —
  don't defer it or split it into a separate PR.
- Keep the change scoped to the issue. Unrelated cleanups you notice go in the
  PR description as a note, not in the diff.

### 5. UI — biddaloy design system

All UI uses the **biddaloy client UI design system**: its components, tokens,
spacing scale, and typography.

- No one-off styles, no ad-hoc hex colors, no new external component libraries.
- If a needed component genuinely doesn't exist, extend the design system
  following its own conventions, and call that out in the plan and the PR
  description so it gets reviewed as a design-system change.
- Stories render against the design system, not raw markup.

### 6. Tests and stories

Every added or changed behavior gets test coverage and, for UI, Storybook
stories covering the meaningful states (loading, empty, error, populated). This
is part of the issue, not follow-up work — a PR without them isn't done.

Run the test suite and lint before committing. Don't push red.

### 7. Graph, commit, push

```bash
graphify update
git add -A            # includes graph changes
git commit -m "..."
git push -u origin <branch>
```

Never commit without running `graphify update` first — a stale graph poisons the
research step for every subsequent issue in the chain.

### 8. Open the PR

Target the parent branch. In the description: what the issue asked for, the
approach, any design-system additions, and how to test it. Then record the PR
number and **timestamp** in the state file.

## Step 3 — PR pacing (CodeRabbit)

CodeRabbit throttles its review if a second PR arrives within an hour of the
first, so a rushed chain gets N shallow reviews instead of N real ones. This
applies only when there's more than one issue in the queue; a single issue opens
its PR immediately.

- Keep **at least 60 minutes** between opening one PR and opening the next.
- The wait is not idle time. Branch the next issue and run its research,
  planning, implementation, tests, and stories — everything up to and including
  the push. Just hold the `gh pr create` until the hour has elapsed.
- Never batch or parallelize PR creation to catch up on time.
- Compute the gap from the recorded timestamp of the last PR, not from when the
  current issue's work finished.

## Step 4 — Surviving compaction

A queued run is long enough that auto-compaction will fire repeatedly, and each
one can drop details you were relying on. Treat conversation context as
expendable and disk as the source of truth.

- The state file and the current issue's plan live **on disk**, not in your
  head. Anything you'd be annoyed to lose — the plan, decisions made, files
  touched, why an approach was rejected — gets written there as it happens.
- After a compaction, re-read `.implement-issue-state.md` and the current
  issue's plan before continuing. Don't reconstruct position from memory.
- Re-run graphify queries rather than trusting a half-remembered result from
  before the compaction. The query is cheap; a wrong assumption about
  dependents is not.
- Don't hold large file contents in context across steps. Read, act, move on.

## Step 5 — Usage limits

When the limit hits: write the current position to the state file, stop
cleanly, and wait for the reset. On resume, read the state file, confirm against
`git status` and `git log`, and continue from that exact step. Don't restart an
issue from scratch, don't skip ahead, and don't re-plan work that's already
planned.

## Rules that hold throughout

- Strictly sequential — one issue in flight at a time.
- Never skip the plan.
- Never commit without `graphify update`.
- Never bypass the design system.
- Never open a PR less than an hour after the previous one.
- Update the state file after every step.

## Report at the end

```markdown
| Issue | Branch | Base | PR | Opened |
|---|---|---|---|---|
```

Plus anything that needs the user's attention: design-system additions made,
issues that turned out larger than scoped, and rebases still pending.