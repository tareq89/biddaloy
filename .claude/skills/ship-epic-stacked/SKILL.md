---
name: ship-epic-stacked
description: Take a set of issues from backlog to a stack of open, unmerged PRs — each branch built on the previous one, each issue planned and implemented like ship-issue, but never merged and never reviewed inline. Stops once every PR is open and hands the whole stack to the user for verification. Use when the user gives an explicit branch-by-branch chain ("make branch #131 from main, plan, implement, make pr; make branch #132 from #131, ..."), or asks to build an epic "as a stack" / "as stacked PRs" / "without merging" / "so I can review before anything merges". Distinct from ship-epic, which auto-merges each issue into main before starting the next — if the user wants that, use ship-epic instead, not this.
---

# Ship an epic as a stacked, unmerged PR chain

Carry a set of issues from backlog to open PRs, stacked branch-on-branch, and
stop. No merges, no epic closure, no review triage — this skill's entire job
ends the moment the last PR is open. What happens to the stack afterward
(review, merge order, closing anything) is the user's call, made once they've
actually looked, not this skill's to decide.

This is `ship-issue` run in a loop with three things different from
`ship-epic`: **explicit-or-derived order instead of dependency inference,
stacked branches instead of fresh-off-main, and a hard stop before any merge
instead of auto-merging.** Read `.claude/skills/ship-issue/SKILL.md` first —
phases 1–3 (pick, plan, build) apply here almost unchanged. This skill only
says which issue is next, what branch it stacks on, what to do instead of
pausing to ask, and where the loop ends.

**If the user wants each issue merged into `main` before the next one starts,
this is the wrong skill — that's `ship-epic`.** The two are not modes of the
same thing; picking wrong means either merging when the user wanted a review
window, or leaving a stack unmerged when they wanted it landed.

## 1. Resolve the stack

Two ways the user hands you the work, and both are valid:

**An explicit, ordered list** — the user types out each step, e.g.:

```
make branch #131 from updated main, plan, implement, make pr
make branch #132 from #131, plan, implement, make pr
make branch #8.7.3 from #132, plan, implement, make pr
...
```

Extract just the ordered refs (`131`, `132`, `8.7.3`, ...) and resolve them:

```bash
python3 .claude/skills/ship-epic-stacked/scripts/resolve_stack.py 131 132 8.7.3 133 ...
```

**An epic id** — the user says "ship epic 8.6 as a stack" with no explicit
order. Derive the order first, the same way `ship-epic` does, then feed that
order through the same resolver so branch names/bases come out identically:

```bash
python3 .claude/skills/ship-epic/scripts/epic_plan.py <epic-number> --json \
  | python3 -c "import json,sys; print('\n'.join(str(i['number']) for i in json.load(sys.stdin)['order']))" \
  | xargs python3 .claude/skills/ship-epic-stacked/scripts/resolve_stack.py
```

(Check `epic_plan.py`'s actual `--json` shape before relying on that pipeline
verbatim — skills drift; the point is dependency order in, `resolve_stack.py`
out, same as the explicit-list path.)

Either way, `resolve_stack.py`'s output is the plan: resolved issue number,
title, the `feature-<dotted>` branch name, and which branch it bases on (the
previous step's branch, or `origin/main` for the first). It also **collapses
duplicate refs** — two labels naming the same underlying GitHub issue (a
phase renumbered after the plan was written, most often) — into a single
step, so the issue doesn't get built twice with an empty second PR. This
happens automatically; it is exactly the kind of decision "always take the
recommended approach" (below) covers, so don't pause to confirm it — just
report the collapse in the final summary.

If a ref has no resolvable `[N.M...]` title prefix, the script exits loudly
rather than guessing a branch name. Handle that one issue manually and
continue the rest of the stack.

Show the user the resolved plan and any collapses before starting.

## 2. Ship each issue, stacked

For every step in the plan, run `ship-issue` phases 1–3 (pick is already done
— skip straight to plan and build) with one change to branch creation:

```bash
git fetch origin <base>          # 'main' only for the first step
git checkout -b <branch> <base>  # <base> is 'origin/main' for step 1,
                                  # the *previous step's branch* after that
git branch --unset-upstream
```

This is the entire mechanism that makes the stack a stack. `[8.6.3]`'s
`FormField` composes `[8.6.2]`'s `Button`/`Input` — it can only see that code
if its branch descends from `feature-8.6.2`, whether or not `feature-8.6.2`
has merged into `main` yet. It usually hasn't; that's the whole point of not
merging as you go.

**One issue, one PR**, same as `ship-issue` and `ship-epic` — a collapsed
duplicate (step 1 above) is the only case where a "step" doesn't get its own
PR, and that's because it was never two issues to begin with.

Open the PR against the **previous step's branch**, not `main`:

```bash
gh pr create --base <previous-branch> --head <this-branch> \
  --title "..." --body "Closes #<N>

..."
```

GitHub will retarget a PR's base automatically once that base branch merges
and is deleted — expect PR bases to visibly shift to `main` over time as
earlier PRs in the stack land. That's normal, not something to fix.

**Do not work the review phase, and do not merge.** This is the biggest
difference from plain `ship-issue`, which works CodeRabbit's findings and
asks about merging as part of shipping each issue. Here, skip straight from
"PR opened" to the next issue. If CodeRabbit (or anyone) comments on a PR
mid-stack, leave it — the user reviews the whole stack later, in their own
time, not issue-by-issue while you're still building the rest of it.

## 3. Decide without asking

Same principle as `ship-epic` section 3, with the merge row removed (there is
no merge decision in this skill) and one row added that `ship-epic` doesn't
need:

| Situation | Do instead |
|---|---|
| "Confirm the choice with the user before writing code" | Take the next item in plan order |
| "Surface material choices to the user before building" | Pick the option you'd recommend; put the choice and reasoning in the PR's Notes section |
| A file/component/etc. looks like it should be deleted (dead code, superseded by this issue's own work, explicitly marked "delete once X lands" and X just landed) | **Do not delete it.** Leave it in place, note *what* and *why* in the current PR's Notes, and carry it forward to the end-of-run report (section 5) as a pending permission request |
| Two labels in the plan resolve to the same GitHub issue | Already handled by `resolve_stack.py` — collapse, don't ask, report it at the end |

"Recommended" means the option you'd defend to the user afterward, with the
PR body as your answer — same standard as `ship-epic`, because the user is
equally not watching in real time here.

## 4. When to stop the whole run

Unlike `ship-epic`, there's no CI-green/review-quiet merge gate to satisfy
per issue, since nothing merges — so most of what stops `ship-epic` mid-run
doesn't apply here. What still does:

- **A migration or change that can lose data**, or touches authentication /
  access control / secret handling where the issue's acceptance criteria
  leave the approach open. Write it, test it, open the PR — flag it clearly
  in the final report as needing a deliberate look, same as anywhere else,
  but don't let it block the rest of the stack from being built.
- **Credentials you don't have.** Don't stub past a real integration and
  report the step as done.
- **The same review finding contested twice** — doesn't apply mid-build since
  you're not working reviews here, but does apply if the user interrupts the
  run to ask you to address something on an already-opened PR before you've
  finished the rest of the stack. Finish that one call, then keep going.
- **A cycle or an unresolvable ref** in the plan (section 1). Stop and ask;
  an automated order can't be trusted once the graph disagrees with itself.

A build failure specific to one issue is not a whole-run stop — finish that
PR as best you can, note the problem plainly in its Notes section, and
continue stacking the rest on top of whatever branch state that issue left
behind (its own problem doesn't block issues after it from being buildable,
since they depend on the code, not on the PR being merge-ready).

## 5. Stop, report, and wait

Once every step in the plan has an open PR (or has been explicitly flagged
and skipped per section 4), the run is over. Do not:

- merge anything
- close the epic issue
- work any PR's review comments
- take any further action at all

until the user says to. Report:

1. **The stack, in order** — issue, branch, PR, base branch, one line each.
   Make the order visible; it's what tells the user which PR to review first
   (base-to-tip — reviewing out of order makes an unrelated PR's diff look
   inflated with everything beneath it, which isn't a bug, just confusing if
   nobody says so upfront).
2. **Any collapsed duplicates**, from section 1.
3. **Every deferred deletion**, collected from section 3 — file, reason,
   which PR flagged it. This is the "delete permission at the very end" the
   user asked for: a clean list they can act on with a single decision each,
   not something they had to catch mid-conversation.
4. **Anything skipped or flagged** per section 4, and why.

Then stop talking and wait. The user reviewing and merging the stack — in
order, one at a time, checking each one actually builds on the last — is a
separate action they'll ask for explicitly. When they do, `ship-issue`
phase 4 (work the review) and its merge gate apply per PR, same as normal;
nothing about having built the stack unattended changes how carefully each
PR gets merged.

## Honesty about state

Same standard as `ship-epic`: the user was not watching the build, so the
report is what they have instead of having seen it. Say plainly which PRs
are open, which issues got collapsed and why, every deletion you deferred
instead of making, and any step where you didn't follow the issue exactly as
written. A stack reported as "all N PRs open, ready for your review" is a
claim the user has no way to check except by opening them — it has to be
exactly true.
