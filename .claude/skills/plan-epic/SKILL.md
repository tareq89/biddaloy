---
name: plan-epic
description: Turn a symptom, idea or vague feature request into a plan-grade epic on GitHub — grill the user in rounds, ground every claim in code first, recap the design as a diagram, widen scope deliberately, lock decisions D1–Dn, then write sub-issues that implement-epic can run on Sonnet without an Opus planner. Use whenever the user invokes /plan-epic, says "plan an epic for…", "X is not working, let's fix it properly", or wants to turn a discussion into tickets. Not for implementing (use implement-epic / implement-issue) and not for a single small issue.
---

# Plan Epic

Output: **one epic issue + N plan-grade sub-issues** in waves, native
sub-issues, on the *Biddaloy Development* project — the exact input shape
`implement-epic` is cheapest on. The process is the one that produced Epic 16
(#637): grill → recap → design → widen → grill the plan → write.

Two cost rules shape everything below:

- **Planning tokens are cheap, re-planning is not.** A sub-issue that is
  plan-grade skips the Opus planner entirely at run time; the implementer
  self-pre-flights it on Sonnet. Every minute here saves ~50k tokens per
  ticket later.
- **The chat is not the artifact.** Decisions go to a scratch file as they
  are made; bodies go to files and are created by script. Nothing important
  lives only in context, so compaction costs nothing.

## Invocation

```
/plan-epic fee generation is not working
/plan-epic academic calendar with holidays and routine
/plan-epic resume            # continue from .plan-epic-<slug>.md
```

## Mode

`/caveman ultra` for narration. The grill questions, the design recap, the
epic body and every sub-issue body stay normal and readable — the user
reviews the design *there*, and Sonnet implements from the bodies with no
other context.

## Phase 0 — Ground before asking

Do this **before the first question**, silently, in one batch of tool calls:

1. `graphify query "<the symptom / feature area>"` and `graphify explain
   "<the main concept>"`. Read the scoped subgraph, not source files.
2. `serena` symbol lookups for the entities, services and routes it names.
3. If the input claims a bug, **verify it** — find the test or the code path
   and confirm the behaviour. Half of "X is not working" is a model problem,
   not a bug, and the whole epic shape depends on which.
4. `gh issue list --search "<keywords>" --state all --json number,title`
   and `ls docs/architecture/` — find the prior epic or doc that already
   covers this area. Read only the one that matches.

Write what you found to the scratch file (below) under **Verified today**,
with `file:line`. Facts are looked up, never asked.

## Scratch file — `.plan-epic-<slug>.md`

Repo root, excluded via `.git/info/exclude` (same idempotent `grep -qxF ||
echo >>` line `implement-epic` uses). Write it at the end of Phase 0 and
after **every** round. It is the resume contract and the source for the epic
body; the conversation is expendable.

```markdown
# plan-epic: <slug>   status: grilling | design | widen | final-grill | writing | done
Input: <the user's words, verbatim>

## Verified today (<date>)
- <fact> — <file:line>

## Scenario (what the user actually wants)
1. …

## Decisions
D1 <decision> — chosen over <alternative> because <one line>
D2 …

## Building blocks
| block | owns | new / changed |

## Open questions
- …

## Out of scope (with why)
- …
```

## Phase 1 — Grill in rounds

Invoke the `grilling` skill on the input. Constraints on top of it:

- **≤5 questions per round**, each with a recommended answer and the
  tradeoff in one line. Numbered so the user can answer `1a 2b 3 yes`.
- Ask only **decisions**. If a question could be answered by reading code,
  answer it yourself first (Phase 0 rule) and state it as a fact.
- When the user picks against your recommendation, take it without
  friction and write it as `Dn … chosen over … because …`. That line is the
  point; it is what stops an implementer relitigating it.
- When the thread wanders — you feel it as "this is getting messy" — stop
  the round, write **Scenario** as a numbered list of what was originally
  wanted, name the detour and drop it explicitly, then re-derive the next
  questions from the scenario.
- A round ends when every question is answered or deferred to **Open
  questions**. The phase ends when a round produces no new decision.

## Phase 2 — Design recap

One message, plain language, for review here rather than in code:

- A Mermaid diagram (`flowchart` for shape, `sequenceDiagram` for a flow,
  `erDiagram` for a data model — pick one, not all three).
- A **building blocks** table: block · what it owns · new / changed / kept.
- The invariants the design must keep (tenant isolation, money-tier
  behaviour, idempotency, whatever applies) — each in one line.
- The decisions so far, by number, in one line each.

Ask for one of: approve / change / "not what I meant". Iterate the diagram,
not prose. Save to the scratch file.

## Phase 3 — Widen deliberately

One pass, one message: *"Anything else that should ride along?"* — but you
propose, the user picks:

- Grouped by area, **cheap-now / expensive-later first** (a column the
  migration should add now, an enum the shared package should carry now, a
  permission that costs one line today and a data fix in six months).
- Each item: one line, a size (S/M/L), and **in / out** as your
  recommendation.
- The user pulls items in or leaves them. Each *out* goes to **Out of
  scope** with its reason so the next epic doesn't re-ask.

## Phase 4 — Final grill on the plan

Invoke `grilling` on the scratch file itself, ~10 questions, targeted at
**calls you made that the user hasn't**: defaults you assumed, orderings you
chose, names you picked, anything a reviewer would ask "why". Fold every
answer into a numbered decision. After this the decision list is **final** —
sub-issues cite them by number and never restate them.

## Phase 5 — Write the epic and sub-issues

### Epic body — `plan/epic.md` in a temp dir

```markdown
# Epic <N> — <title>

## Goal
## What is wrong today (verified <date>)      ← from Verified today, with file:line
## Building blocks                           ← the table from Phase 2
## Waves                                     ← Mermaid flowchart, one node per wave, edges = depends-on
## Decisions                                 ← D1–Dn, final, one line each
## Invariants
## Screens                                   ← only if UI; which shell / pattern each screen reuses
## Review tier overrides                     ← optional explicit money-tier list; otherwise implement-epic's path rule applies
## Out of scope
```

### Sub-issue bodies — `plan/<wave>-<seq>-<slug>.md`

Every body **must** carry all of these sections, in this order. This is the
contract that makes it plan-grade; a missing heading sends it to the Opus
planner at run time and wastes everything above.

```markdown
## Goal
one sentence — what "done" means
## Files
- server/src/modules/fees/wallet.service.ts (new)
- shared/src/enums/fee.ts
## Steps
1. …ordered, concrete, names the existing thing to clone…
## Tests
- <file>: <cases>
## Acceptance
- [ ] …
Wave: <N>   Decisions: D3, D7   Depends on: #<n> (or "—")
```

Slicing rules — these are what make `implement-epic` run without conflicts:

- **Sonnet-low sized**: one lane of work, ≤ ~15 files, one afternoon. If you
  can't write `## Steps` without a paragraph of reasoning, split it.
- **File-disjoint inside a wave.** Two tickets in one wave never name the
  same file. If they must, they are one ticket or two waves.
- **`shared/` is touched by exactly one ticket per epic**, in wave 1.
- **Hot paths are one ticket each per wave**: `server/src/migrations/**`,
  `ui/src/api/schema.d.ts`, `client-admin/src/routeTree.gen.ts`,
  `ui/src/hooks/**`, `ui/src/i18n/locales/**`.
- **Every wave ends with a wave-close ticket**: seed data, api-types
  regeneration, e2e for that wave's screens. Wave N+1 depends on it.
- **Money-tier tickets** (migrations, fees/invoices/reports/auth internals,
  anything that deletes or bulk-mutates tenant data) get their own line in
  the epic's *Review tier overrides* so nobody has to infer it later.
- **`## Steps` names the existing thing to clone** — a component, a service,
  a test file — by path. Sonnet copies well and invents badly.
- Never restate a decision in a body; cite `Dn`. Never describe the whole
  epic in a body; it has `Wave:` and `Depends on:` and that is enough.

### Create everything in one command

Write the files, then:

```bash
.claude/skills/plan-epic/scripts/create-epic.sh plan/ --project 2
```

It creates the epic, creates each sub-issue, links them as **native**
sub-issues, adds all of them to the project, and prints `number|title|url`
lines. Paste the printed table into the scratch file and mark it `done`.
Do not create issues one `gh` call at a time in chat.

## Phase 6 — Hand off

Print the epic URL, the wave table, and the exact next command:

```
/implement-epic <N>            # runs all waves
/implement-epic <N> --only w1  # first wave only
```

Then save what was *surprising* to memory (the reframe, an overridden
recommendation, a deferred item with its context) — not the plan itself,
which is on GitHub.

## Rules that hold throughout

- Never ask something you could look up. Never state as fact something you
  didn't look up.
- Never let a decision live only in chat — scratch file first, then the epic
  body.
- Never write a sub-issue without all five sections; never let two tickets in
  a wave share a file; never let two tickets touch `shared/`.
- Never create issues before Phase 4 is done — editing forty bodies after a
  late decision costs more than the whole grill.
- Batch tool calls: all of Phase 0 in one message; all body files written in
  one message; one script run to create.
