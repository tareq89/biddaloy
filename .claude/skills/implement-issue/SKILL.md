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
/implement-issue plan 8.10.1
```

Accepted input:

- **A single issue ID/number/link** → work that one issue and stop.
- **A list of issue IDs, numbers, or links** → work them in the order given.
- **An epic ID/number/link** → resolve its child issues into an ordered queue,
  then work them in order.
- **`resume`** (or no argument, when a state file exists) → read the state file
  and continue.
- **`plan <issue…>`** → run research and planning only, publish each plan to its
  GitHub issue, and stop without writing code. See *Splitting a run across
  effort levels*.

## Mode

Run the entire session in `/caveman wenyan-ultra` mode so input and output
tokens stay minimal. Invoke it at the start if it isn't already active.

This governs **your conversational output**, not the artifacts. Code, tests,
stories, commit messages, PR descriptions, and the per-issue plans must stay
normal, complete, and readable — a compressed plan defeats its own purpose,
since the user needs to be able to review it.

## Model routing

**You cannot switch your own model.** `/model` and `/effort` are user-side CLI
commands; emitting them as output text does nothing at all. The only model
switch available to you mid-run is delegating a phase to a subagent that is
pinned to a model in its own definition.

So the routing is: both the heavy-thinking phase and the implementation phase
are delegated to subagents pinned to their own models, and whatever is left runs
on whatever the user set before invoking this skill.

| Phase | Runs on | How |
|---|---|---|
| Research + plan (steps 2–3) | Opus | `issue-planner` subagent (`.claude/agents/issue-planner.md`, `model: claude-opus-5`) |
| Implement, tests, stories (steps 4–6) | Opus | `issue-implementer` subagent (`.claude/agents/issue-implementer.md`, `model: claude-opus-5`) |
| Code review (step 7) | the session's model | in this session |
| Commit, push, PR (steps 8–9) | the session's model | in this session |

Planning is delegated rather than done in-session for the same reason
implementation is: it pins the phase to the right model regardless of what the
session happens to be running on. It also means the plan is produced by an agent
whose only job is the plan, and published to GitHub before any code exists.

Before starting, check what the session is actually running on and say it out
loud in one line: *"Session model: <X>. Planning goes to the Opus subagent,
implementation to the Opus subagent; review, commit and PR run here."*

### Effort cannot be routed per phase

Effort is **one setting for the whole session.** There is no per-agent effort
field, so both subagents run at the session's level, not at a level this skill
or the agent definition chooses. You cannot change it mid-run, and emitting
`/effort` as text does nothing.

This means a single run **cannot** give you "plan at max, implement at low."
The model split is real; the effort split is not available. Never claim
otherwise in a report.

When the active model doesn't support the level set, it falls back to that
model's highest supported level at or below it — so a subagent under an `xhigh`
session runs at its model's ceiling, which is expected, not a misconfiguration.

### Splitting a run across effort levels

If the user does want planning at high effort and implementation at low, it
takes two invocations, because effort only changes between sessions:

1. User sets `/effort max`, then runs `/implement-issue plan 8.10.1`. This does
   steps 0–3 only: resolve, research, plan, publish the plan to the GitHub
   issue, update the state file, and stop. No code is written.
2. User sets `/effort low`, then runs `/implement-issue 8.10.1`. Step 3 finds
   the published plan already on the issue and skips straight to step 4.

Step 3 is idempotent for exactly this reason: a plan comment that already exists
and is current is not rewritten. If the user asks for both effort levels in one
run, tell them plainly that it takes these two invocations rather than silently
delivering one level for both phases.

If the session's `Do not call the Agent tool unless the user requested it` rule
is in force, treat invoking this skill as that request — delegation is how this
skill is specified to work. If the tool is genuinely unavailable, implement in
this session and note in the final report that the whole run was single-model.

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
Plan: https://github.com/org/repo/issues/171#issuecomment-123456
PR: #123 opened 2026-08-22T09:14Z

## 8.10.2 — <title>
Branch: feat/8.10.2-<slug>  |  Base: feat/8.10.1-<slug>
Status: in-progress — step 4 (tests written, stories pending)
Plan: https://github.com/org/repo/issues/172#issuecomment-123499
PR: —
```

Update it after **every** completed step, not just every issue. Statuses:
`pending`, `planning`, `planned`, `in-progress — step N`, `pushed`, `pr-open`,
`done`. `planned` is where a `plan`-only invocation stops.

The `Plan:` line points at the published plan comment — the plan itself is not
copied into this file. One canonical copy on GitHub beats two copies that drift.

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

### 2–3. Research and plan — delegated to Opus

Dispatch the `issue-planner` subagent (Opus) with the issue ID and the base
branch. It owns graphify research, verification against the current code, the
written plan, and publishing that plan to the GitHub issue as a comment. Its
definition carries the full contract.

**Check for an existing plan first.** Run `gh issue view <n> --json comments`
and look for a comment headed `## Plan — <issue id>`. If a current one is
already there — because a `plan`-only invocation produced it earlier, or a
previous session got this far — **do not re-plan.** Skip to step 4. This is what
makes the two-invocation effort split work, and it's what stops a resumed
session from burning the expensive phase twice.

What the parent still owns here:

- **Publishing is the planner's job, not yours.** Confirm it returned a comment
  URL. A plan that exists only in the conversation is a plan that dies with the
  context.
- **Scope escalation.** If the planner reports the issue is much bigger than its
  label suggests, say so to the user before starting implementation rather than
  after.
- **Corrections.** Record every **Plan correction** the planner found; these go
  in the PR description, because they're the parts a reviewer can't infer from
  the diff.

Record the plan comment URL in the state file. The GitHub comment is the durable
artifact; the state file tracks position and points at it.

### 4–6. Implement, UI, tests and stories — delegated to Opus

The plan is published, so handing this phase off costs nothing. Dispatch the
`issue-implementer` subagent (Opus) with the issue ID; it reads the plan from
the issue's comments itself. Let it do the code, the backend work, the UI, the
tests, and the stories. Its definition carries the full contract — design
system, test and story coverage, scope discipline, no committing.

Two things the parent still owns:

- **Escalation.** If the subagent reports the plan is wrong rather than merely
  incomplete, re-dispatch the `issue-planner` to revise and re-publish the plan,
  then dispatch the implementer again. Don't let a new approach get improvised
  at implementation effort, and don't rewrite the plan yourself — the whole
  point of pinning planning to its own model is that it doesn't happen wherever
  the session happens to be.
- **Acceptance.** When it returns, verify rather than trust: read the diff, and
  re-run the test suite and lint yourself. A subagent's "tests pass" is a claim
  until you've seen the output. Don't proceed to review on red.

Unrelated cleanups the subagent reports go in the PR description as a note, not
in the diff.

### 7. Code review

Invoke the `code-review` skill on the working tree **before** committing, so
fixes land in the same commit rather than as follow-up noise in the PR diff.
(It's a skill, so you invoke it directly — unlike `/model`, this one really
runs.)

Act on what it finds:

- Fix anything real. Re-run tests and lint after the fixes.
- If a finding is a deliberate choice, note it in the PR description rather than
  silently ignoring it.
- If it surfaces a design problem rather than a defect, update the published
  plan comment before rewriting — the plan should end the issue matching what
  was actually built.

This is your reviewer before CodeRabbit is your reviewer. Anything caught here
is a fix; anything caught there is a round trip.

### 8. Graph, commit, push

```bash
graphify update .     # keeps YOUR graph current; its output is gitignored
git add -A
git commit -m "..."
git push -u origin <branch>
```

Run `graphify update .` before moving on — a stale graph poisons the research
step for every subsequent issue in the chain. Its output never enters the
commit: the generated files under `graphify-out/` were untracked on 2026-08-29,
because an 8.8 MB blob regenerated per commit is unmergeable across branches.
Keeping the graph fresh is now free.

(`graphify-out/README.md` and `cost.json` remain tracked — they are
documentation and the provenance record of what the graph build spent, not
generated output. `graphify update .` does not modify them.)

Regenerate committed artifacts that the change invalidates before committing —
API types in particular, if endpoints or DTOs moved. A generated file that
drifts from its source fails CI and costs a whole round trip.

### 9. Open the PR

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
expendable; the state file on disk and the plan comment on GitHub are the
sources of truth.

- The state file lives **on disk** and the plan lives **on the GitHub issue**,
  not in your head. Anything you'd be annoyed to lose — decisions made, files
  touched, why an approach was rejected — gets written to one of them as it
  happens.
- After a compaction, re-read `.implement-issue-state.md` and re-fetch the plan
  comment before continuing. Don't reconstruct position from memory.
- Re-run graphify queries rather than trusting a half-remembered result from
  before the compaction. The query is cheap; a wrong assumption about
  dependents is not.
- Don't hold large file contents in context across steps. Read, act, move on.

## Step 5 — Usage limits

When the limit hits: write the current position to the state file, stop
cleanly, and wait for the reset. On resume, read the state file, confirm against
`git status` and `git log`, and continue from that exact step. Re-check what
model the resumed session is on and report it, as at the start of a fresh run —
the resume may land on a different one than the work so far was done at. Don't
restart an issue from scratch, don't skip ahead, and don't re-plan work that's
already planned.

## Rules that hold throughout

- Strictly sequential — one issue in flight at a time.
- Never skip the plan.
- Never plan inside the implementer subagent; never let it commit.
- Never start implementation before the plan is published to the GitHub issue.
- Never re-plan an issue that already has a current plan comment.
- Never claim a model switch happened that you didn't make by delegation, and
  never claim an effort switch happened at all — effort is session-wide and
  you cannot change it.
- Never commit before the `code-review` skill has run and its findings are
  resolved.
- Never leave a stale graph behind; never commit generated graph output.
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