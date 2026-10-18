# QA audit lessons (Epic #2642)

Epic #2642 fixes what a pre-launch QA audit found. Each fix should leave
behind a rule and a test, so the same bug class cannot come back. This doc is
where that trail is kept: first the map, then the learnings from each wave,
then the baseline every wave-close ticket compares against.

```mermaid
flowchart LR
  F[QA finding] --> R[root cause] --> U[rule] --> T[enforcing test] --> C[code]
```

## Defect classes

One row per class. The wave that fixes it is in the first cell. `TBD` is
filled in by that wave's close ticket.

| Defect class | Root cause | Rule | Enforcing test | Code |
| --- | --- | --- | --- | --- |
| Error mapping (W1) | TBD | TBD | TBD | TBD |
| Real dates and ranges (W1) | TBD | TBD | TBD | TBD |
| Checkout money and replay (W1) | TBD | TBD | TBD | TBD |
| Step-up access (W1) | TBD | TBD | TBD | TBD |
| Input length and number range (W2) | TBD | TBD | TBD | TBD |
| Referential deletes (W2) | TBD | TBD | TBD | TBD |
| Report reads (W2) | TBD | TBD | TBD | TBD |
| Fee rows (W2) | TBD | TBD | TBD | TBD |
| Import (W3) | TBD | TBD | TBD | TBD |
| Backup and restore (W3) | TBD | TBD | TBD | TBD |
| Accessibility and responsive (W3) | TBD | TBD | TBD | TBD |
| Mutation retries and double submit (W4) | TBD | TBD | TBD | TBD |
| Truthful lists and phone input (W4) | TBD | TBD | TBD | TBD |
| Student form and send (W5) | TBD | TBD | TBD | TBD |

## Learnings log

Raw notes from each wave close, same format as the
[Learnings log in 08-security.md](08-security.md#learnings-log-epic-75): what
surprised us, what it cost, the fix, a rule candidate, then an arrow to the
rule it became (`→ Rule N`) or `→ no rule` with the reason.

### Wave 1

Learnings log, 2026-10-19 (format: surprise, cost, fix, rule candidate -> rule or no rule).

- **A new Permission broke an unrelated "exact list" pin.** Granting `STEP_UP_REQUEST` to EXAM_CONTROLLER failed the D16 pin in `shared/src/enums/permissions.spec.ts`; only the full suite showed it. Cost: one red at wave close. Fix: pin updated. Rule candidate: a ticket that adds a permission or role grant greps the `*.spec.ts` exact-list pins and runs the shared permissions spec first -> checklist item, no security rule.
- **A sibling service kept the bug the first one lost.** `payment-allocation.service.ts` still echoed `idempotency_key` after checkout stopped. Cost: Rule 23 gap found at wave close. Fix: id-free wording. Rule candidate: when removing an echo in one service, grep sibling services for the same message shape -> Rule 23 (add a "grep siblings" note when rules 24-27 are written).
- **Load timeouts look like red tests.** About 12 integration tests timed out on a shared machine and all passed alone. Cost: about 20 minutes of triage. Fix: rerun failures alone under `yarn test-env run` before judging. -> no rule (D18 wording).
- **Browser suites cannot run while dev servers hold ports 3000 and 5174.** `playwright.config.ts` hard-codes both. Cost: e2e, pwa and axe were not run at the baseline or the wave-1 close. Fix: none yet; run them on a machine with free ports. -> no rule.
- **NOT VALID CHECKs still check new and changed rows.** A restore of an old backup can hit `CHK_sf_paid_plus_discount`. Found by the PR 1 review. Fix: per-row restore validation and a deploy step (#2662). -> Rule candidate for rules 24-27 (money CHECKs and restore).

### Wave 2

### Wave 3

### Wave 4

### Wave 5

## Appendix: Baseline on 901764f4a

Measured on clean `origin/main` `901764f4a`, 2026-10-19, Node v24.20.0, in a
fresh worktree. "Red" = failed alone and in the full run. "Flaky" = failed in
the full run, passed on re-run with no code change (D18). Wave-close tickets
treat the red list as "known red".

| Suite | Command | Result | Red tests | Flaky tests |
| --- | --- | --- | --- | --- |
| Typecheck | `yarn typecheck` | pass (717 s) | none | none |
| Verify (lint, format, guards) | `bash scripts/ci-local.sh --integration --e2e` (verify section) | pass | none | none |
| Frontend | same run (frontend section) | pass: 787 files, 8868 tests | none | none |
| Audit | `bash scripts/ci-local.sh --only audit` | pass (allowlisted advisories only) | none | none |
| Server integration | same run (integration section) | 16 failed, 3298 passed, 13 skipped (270 files); all 16 pass when the 13 files are re-run alone (282 passed) | none | see list below |
| Server e2e (API) | `ci-local.sh` stops at the first red section, so not reached; `--only e2e` also could not start | not run | unknown | unknown |
| Playwright e2e | `yarn e2e` | not run: ports 3000 and 5174 held by a foreign long-lived dev stack | unknown | unknown |
| PWA | `yarn e2e:pwa` | not run: same port 3000 clash | unknown | unknown |
| Axe | `yarn e2e e2e/a11y` | not run: same port clash | unknown | unknown |

Why the browser suites did not run: `playwright.config.ts` hard-codes
`localhost:3000` and `:5174`. On the baseline machine a dev API (`dist/main`,
started Oct 17) and a vite server (started Oct 16) from another checkout were
already listening. They were not mine to kill, and reusing them would not
measure clean `main`. A wave-close ticket on a machine with free ports should
run these three and fill the rows.

Flaky server integration tests (all failed with a 5 s test or 10 s hook
timeout while other lanes loaded the machine, passed alone):

- `src/modules/seat-plans/seat-plans.integration.spec.ts` (suite hook)
- `test/subject-choice-groups-migration.integration.spec.ts`
- `src/modules/attendance/absence-notice.service.integration.spec.ts`
- `src/modules/attendance/attendance-summary.service.integration.spec.ts`
- `src/modules/audit/audit-dashboard.integration.spec.ts`
- `src/modules/calendar/calendar-import.service.integration.spec.ts`
- `src/modules/invoices/invoice-send.sms-credit.integration.spec.ts`
- `src/modules/presets/preset-apply.integration.spec.ts`
- `src/modules/promotions/promotions.service.integration.spec.ts`
- `src/modules/users/users.service.integration.spec.ts`
- `src/modules/workbook/export/export.integration.spec.ts`
- `src/modules/workbook/restore/restore.integration.spec.ts` (5 tests)
- `src/modules/workbook/tabs/academics/study-plans.tabs.integration.spec.ts`

Frontend flake pass (`yarn vitest run --reporter=json`, 3 passes, then
`node scripts/flake-report.mjs`):

```text
All green across 3 passes. No flakes, no failures.
```
