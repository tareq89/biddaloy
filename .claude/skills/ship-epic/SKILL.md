---
name: ship-epic
description: Take a whole biddaloy epic from backlog to closed — order its sub-issues by dependency, then ship each one as its own PR using the ship-issue process, merging each before starting the next, and close the epic at the end. Runs unattended, taking the recommended option at every decision point. Use when the user says "ship epic 8.1", "do all of #90", "work through this epic", "finish epic 8.7", or otherwise asks for an entire epic rather than a single ticket.
---

# Ship an epic

Carry an entire epic to done: every sub-issue shipped as its own PR, each merged
before the next begins, the epic closed at the end with a summary of what landed.

This is `ship-issue` run in a loop with three things added — dependency
ordering, unattended decision-making, and epic closure. **Read
`.claude/skills/ship-issue/SKILL.md` first and follow it for the per-issue
work.** Nothing here replaces it; this skill only says which issue is next, what
to do when a decision is needed, and when to stop.

## What "unattended" changes, and what it costs

`ship-issue` deliberately stops before merging: *"Merging is effectively
irreversible on a shared branch… that's the moment to have a human in the
loop."* This skill overrides that. That override is the whole point of it, and
it is a real trade — it was the final check that caught the worst bug in PR #55.

So the safety has to move somewhere. It moves into the merge gate in phase 4 and
the stop list in "When to stop and ask". Those are not ceremony; they are the
only thing standing between an unattended loop and a bad merge.

Worth saying once, plainly: this repo handles fees, payments and PII, and parts
of phase-8 touch credential encryption and access control. Unattended merging is
a reasonable choice for scaffolding and test infrastructure, and a sharper one
for those. If the user wants a checkpoint before merges on a particular epic,
they only have to say so — honour it for that run.

## 1. Plan the epic

Take the epic the user named. If they gave a dotted id ("epic 8.7") rather than
an issue number, resolve it by title.

```bash
python3 .claude/skills/ship-epic/scripts/epic_plan.py <epic-number>
```

This resolves the ordering properly, which a regex cannot. Sub-issue bodies
declare dependencies in the repo's dotted numbering — `**Depends on:** #8.1.1` —
and that is *not* a GitHub issue number; GitHub renders it as a link to issue 8
followed by the text ".1.1". The script maps dotted ids to real issue numbers
via `[N.M.K]` title prefixes, expands wildcards like `#8.2.x`, topologically
sorts, and breaks ties in numbering order.

Read the output before starting:

- **`blocked by #N`** — an ordering edge inside this epic. The sort already
  handles it; you just cannot start that item early.
- **`external: 8.6.9`** — a dependency in a *different* epic. Check whether it
  is closed. If it is not, that item is genuinely not startable; note it and
  work the rest.
- **A cycle** (exit code 1) — stop and ask. A cycle means the issues disagree
  about order and no automated choice is safe.

Show the user the plan and the count before starting. If they scoped it ("just
the first three"), respect that.

## 2. Ship each issue in order

For every open item in plan order, run the full `ship-issue` process — plan,
build with tests, PR, work the review. Two rules specific to the loop:

**Branch from fresh `origin/main` after the previous merge.** Not from the
previous feature branch, and not from a stale local `main`.

```bash
git fetch origin main
git checkout -b feature-<N.M.K> origin/main
git branch --unset-upstream
```

This is what makes the chain work. `[8.7.9]` cannot be built without `[8.7.8]`'s
encryption service existing, and it only exists on `main` once its PR merged.
Branching from anywhere else either misses that code or drags an unmerged diff
into the next PR.

**One issue, one PR.** Never batch two sub-issues into a PR to save a round
trip. The epic's value as a review record comes from each PR mapping to one
issue and closing it via `Closes #N`.

## 3. Decide without asking

At every point where `ship-issue` says to confirm or surface a choice, **take
the option you would have recommended** and keep going. Concretely:

| `ship-issue` says | Do instead |
|---|---|
| "Confirm the choice with the user before writing code" | Take the next item in plan order |
| "Surface material choices to the user before building" | Pick the option you'd recommend; put the choice and the reasoning in the PR's Notes |
| Review triage: fix / push back / defer | Default to **fix**. Push back when the finding is wrong and you can show why. Defer only when the fix genuinely needs infrastructure that does not exist |
| "Then ask whether to merge" | Merge, if the gate below is satisfied |

Recommended does not mean cheapest. It means the option you would defend to the
user if they asked afterwards — because they will, and the PR body is your
answer. Write down every non-obvious call at the time you make it; a decision
you cannot reconstruct later is indistinguishable from a mistake.

**The merge gate.** Merge only when all of these hold:

- CI is green — not "the review ran", actually green.
- `review_threads.py open <pr>` returns no unresolved findings other than
  deliberate deferrals you have replied to with reasoning.
- **A review actually ran and has gone quiet.** See "Waiting out a review"
  below. `0 threads` on its own is never enough.
- Build, lint and unit tests pass locally.
- Anything touching infrastructure was exercised for real, per `ship-issue`
  phase 3 — a migration run against seeded, awkward-shaped data, not an empty
  table.

If any of those fail, this issue stops. It does not get merged anyway and it
does not get quietly skipped.

```bash
gh pr merge <pr> --merge
```

Then confirm the merge landed, the issue auto-closed via `Closes #N`, and sync
local `main` before the next item.

### Waiting out a review

`0 threads` from `review_threads.py` is ambiguous. It means *reviewed, found
nothing* or *never reviewed at all*, and those look identical. CodeRabbit
rate-limits on a rolling window, and a long epic run hits that limit routinely —
so this is the normal case, not an edge case.

```bash
python3 .claude/skills/ship-epic/scripts/review_state.py <pr>
```

```
0  settled       — reviewed, and quiet for 30 minutes. Proceed.
1  still settling — reviewed, but comments are still landing. Re-check later.
2  not reviewed   — rate limited, or no completed-review marker. Trigger one.
```

Use the script rather than hand-rolling the check. Three things make the manual
version wrong in ways that fail *open*, and it gets all three right: the bot's
login differs between REST (`coderabbitai[bot]`) and GraphQL (`coderabbitai`);
the summary comment is **edited in place**, so `created_at` can understate the
last activity by hours; and inline findings live in a different endpoint from
the summary.

**On exit 2, trigger a review.** The rate-limit notice says when the next one is
available ("Next review available in: 14 minutes"). Wait that long plus a small
margin, then:

```bash
gh pr comment <pr> --body "@coderabbitai review"
```

Pushing new commits also triggers a review, but never manufacture an empty
commit for that. Trigger at most twice; if both come back rate limited, stop and
tell the user — something is throttling harder than waiting will fix.

**On exit 1, wait it out.** A review arrives as a burst, not one atomic event,
so "a comment exists" does not mean it has finished. Only exit 0 makes
`review_threads.py open <pr>` mean what it appears to mean.

Both halves of that gate carry weight, and the failure is asymmetric: thirty
minutes of silence *while rate limited* is a queue, not an approval. That is not
hypothetical — PR #197 sat silent for 33 minutes having never been reviewed at
all, and a quiet-window check alone would have merged it.

**Do not idle while waiting.** The wait is per-PR, not global. Work the next
independent item in the plan, or handle findings already in hand, and re-check
on the way past. Blocking the whole loop on one PR's reviewer wastes the run.

### Red CI that your PR did not cause

Before treating a red check as *this issue's* problem, find out whether `main`
is red too. A repo-wide failure blocks every PR in the epic, so diagnosing it
once beats re-hitting it six times.

```bash
gh run list --branch main --workflow <workflow> --limit 1
git diff origin/main -- yarn.lock package.json   # empty ⇒ you did not move deps
```

If `main` fails identically and your diff cannot explain it, **the fix is its
own PR, not a stop.** Land that first, then rebase the feature branch onto it
and carry on. Do not bundle the fix into the feature PR — it belongs in the
history as a separate, revertable change with its own reasoning.

Two things this run got wrong, both worth avoiding:

- **A pre-existing failure was treated as a hard stop.** It stalled the whole
  epic on something that took one small PR to fix. "Not caused by this issue"
  means *investigate separately*, not *give up*.
- **An inherited "this cannot be fixed" comment was believed.** A dated
  allowlist entry claimed upgrading `brace-expansion` was impossible because it
  breaks typeorm's bundled `minimatch@3`. True for a cross-major jump; false
  for the patch bump actually needed — every consumer's declared range already
  permitted the fixed version, so the lockfile was stale, not pinned.

  Re-derive the constraint before accepting it. Comments record what was true
  when someone wrote them, and dependency trees move underneath them. Check
  what each consumer actually *declares*, not just what is installed.

## 3b. Delegating to a subagent

Only when the user asks for it. Left alone, run the loop yourself.

**One agent at a time. Never concurrently.** Not because of any platform limit,
but because parallel agents collide on exactly the files an epic touches most:
`yarn.lock`, root `package.json` workspaces and scripts. Lockfile conflicts do
not merge — resolving one means discarding a side and reinstalling, which throws
away whichever agent finished second. Sequential branches never hit this.

`epic_plan.py` output often *looks* parallelisable — epic 8.1 forks three ways
after its root task. Resist it. The graph describes what could run at once, not
what merges cleanly at once.

**Reuse one agent across the epic; do not spawn one per task.** A new `Agent`
call always cold-starts, so a fresh agent per task re-derives the repo layout,
the workspace conventions and the whole `ship-issue` process every time — and
task 5's agent would not know what task 2 built. Spawn once, then continue it
with `SendMessage` using its ID, which keeps its context intact.

Do not rely on that context surviving a session restart. If it is gone, spawn a
fresh agent and re-run `epic_plan.py`; it reads real state from GitHub, so
nothing is lost but warm-up.

Two things the delegating side owns:

- **Relay the report.** A subagent's final report goes to you, not the user. An
  unrelayed finding is an invisible one, and the user was already not watching.
- **Re-verify before merging.** The merge gate is yours, not the agent's. "The
  agent said tests pass" is not the gate; a green CI run and a real review are.

## 4. When to stop and ask

Finish the current issue and stop the loop for any of these. Each is a case
where continuing would either compound an error or make a call that is not
yours:

- **CI still red after two fix attempts** *for a failure your change caused*. A
  third is guessing. A failure that also reproduces on `main` is not this — see
  "Red CI that your PR did not cause" above, and fix it in its own PR.
- **The same finding contested twice.** `ship-issue` already says this needs a
  human; in a loop it is also how you burn an hour re-litigating.
- **A migration that can lose data** — dropping a column or table, or a backfill
  with no reversible path. Write it, test it, open the PR, do not merge it.
- **A change to authentication, access control, or secret handling** where the
  issue's own acceptance criteria leave the approach open. Following stated
  criteria is fine; choosing a security posture unattended is not.
- **Credentials you do not have.** Do not stub past a real integration and
  report it as done.
- **A blocked item whose blocker failed.** Skip it and every item that
  transitively depends on it — *not* everything later in the plan. A topological
  order routinely places independent work after unrelated blocked work, and
  epic 8.1 is exactly that shape: it forks three ways after its root task, so a
  failure in one fork leaves the other two perfectly startable. Read
  `deps`/`blocked by` to decide, never plan position.

Stopping is not failure. Report where the loop got to, what is merged, what is
open, and what you need — then let the user unblock it.

When a *non-blocking* item fails, prefer continuing: mark it, move to the next
independent item, and collect the failures for the final report. Halting an
entire epic over one unrelated task wastes the run.

## 5. Close the epic

Once every sub-issue is closed:

1. Re-run `epic_plan.py` to confirm — `N/N sub-issues closed`. Trust the tool,
   not your memory of the loop.
2. Verify against merged `main`, not against your last feature branch:
   `yarn build`, `yarn lint`, `yarn test:unit`. Independently-green PRs can
   still combine badly.
3. Check the epic's own Definition of Done. The DoD is written at a level no
   single sub-issue covers — "an accountant completes find → collect → receipt
   in three interactions" is a property of the whole epic. If a DoD item is not
   met, the epic is not done; say which, and open an issue for it.
4. Comment on the epic with what shipped: each issue, its PR, notable
   deviations, and every decision you took unattended.
5. Close it.

```bash
gh issue close <epic> --comment "$(cat <<'EOF'
...summary...
EOF
)"
```

If the epic has a DoD item you could not satisfy, leave it **open** and say why.
An epic closed with unmet criteria is worse than one left open, because it
stops anyone from looking again.

## Resuming

Long runs get interrupted. Never rebuild state from memory — `epic_plan.py`
reads it from GitHub, showing `✓` for closed items and the real remaining order.
Re-run it and continue from the first open item.

Before restarting, check for work already in flight:

```bash
gh pr list --state open --search "<N.M.K>"
```

A half-finished PR from a previous run gets picked up at `ship-issue` phase 4,
not rebuilt from scratch.

## Honesty about state

Everything in `ship-issue`'s honesty section applies, and matters more here
because the user was not watching. They are reading your report *instead of*
having seen the work.

Say plainly which issues merged, which are open and why, what you skipped, and
every decision you made on their behalf — especially the ones that went against
what the issue literally asked for. "Epic complete" from an unattended loop is a
claim the user has no independent way to check, so it has to be exactly true.
