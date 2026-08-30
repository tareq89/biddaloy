# Biddaloy

A school management system. Monorepo: NestJS backend + Vite React clients.

For how the system is architected (domain model, multi-tenancy, the fees/
payments/invoices flow, security posture, etc.), see
[`docs/architecture/`](docs/architecture/README.md). This README covers
getting the app running, developing, testing, and deploying it.

## Prerequisites

- Node.js 22+
- Yarn 1.x
- PostgreSQL 16+

## Setup

```bash
yarn install
cp .env.example .env
# Edit .env with your DATABASE_URL and other credentials
```

`yarn install` also installs a pre-commit hook (husky's `prepare` script) — no
separate setup step needed.

### Code graph (optional, but agents expect it)

`graphify-out/` holds a queryable graph of the codebase. Its generated output
is **gitignored** — a derived artifact rebuilt from source — so a fresh clone
has none. (Only `graphify-out/README.md` and `cost.json` are tracked.) Build it
once:

```bash
graphify update .
```

AST-only, no API cost. Re-run it **after modifying code** — a stale graph makes
`graphify query`/`explain`/`path` inaccurate, and refreshing costs nothing since
the output never gets committed.

### Pre-commit hooks

Every commit runs [lint-staged](https://github.com/lint-staged/lint-staged)
(`.husky/pre-commit` → `lint-staged.config.mjs`) against **staged files
only**: `prettier --write` everywhere Prettier applies, plus `eslint --fix`
for `ui`/`client-admin` source (`scripts/lint-staged-eslint.mjs`
handles running ESLint with the right per-package working directory, since
ESLint 9's flat config only looks for `eslint.config.*` in the current
directory, not by walking up from each file). A remaining, unfixable error
aborts the commit with the normal `eslint`/`prettier` output — file, rule,
message.

Deliberately **not** run here: `tsc`, tests, `knip`. Those stay in CI. A slow
hook gets bypassed with `--no-verify` out of habit, and a routinely-bypassed
hook is worse than no hook at all — it creates false confidence that nothing
slipped through.

Escape hatch for a genuine emergency (a hotfix that can't wait, a hook that's
misbehaving): `git commit --no-verify`. Use sparingly — anything skipped this
way still has to pass CI before it can merge, so this only saves time
locally, not the safety net itself.

## Development

Bring up Postgres and Redis first — the server won't boot without them:

```bash
docker compose up -d db redis
```

Then run the server and whichever client(s) you're working on, each in its own
terminal:

```bash
# Terminal 1: NestJS server (auto-reload)
yarn dev:server

# Terminal 2: The client (HMR)
yarn dev:client-admin
```

Open the port Vite prints for `client-admin` (5174 by default) in your
browser. One SPA serves every audience: staff land on `/dashboard`, a
PARENT or STUDENT lands on `/portal`. Vite proxies `/api/*` requests to the
NestJS server at port 3000.

### Running a client against mocks, no backend

Set `VITE_USE_MOCKS=true` in that client's `.env.local` and skip
`yarn dev:server`/Docker entirely — MSW's browser worker intercepts every
API call instead. See [`ui/README.md`](ui/README.md#mocking-msw) for how
the handler library (populated by [8.4.2]) and the worker itself work.

### Regenerating API types

`ui/src/api/schema.d.ts` is generated from the server's OpenAPI document and
must stay in sync with it (`yarn workspace @biddaloy/ui check:api-types`
enforces this in CI). After changing a server endpoint or DTO:

```bash
yarn api:types
```

This regenerates `server/openapi.json` (`docs:generate`) and then
`ui/src/api/schema.d.ts` from it — see [`ui/README.md`](ui/README.md#api-client)
for what the generated client does with those types, or
[`docs/architecture/03-backend-modules.md`](docs/architecture/03-backend-modules.md#api-documentation-swagger)
for how OpenAPI generation itself works.

## Server Testing

```bash
# Server tests
yarn test

# Single run (CI)
yarn workspace @biddaloy/server test:run
```

Unit tests (`yarn test:unit`) need no infrastructure. Integration and e2e tests
need a dedicated Postgres and Redis, and read their config from
`server/.env.test` (gitignored — copy `.env.example`, point `DATABASE_URL` at a
database whose name contains `test`, e.g. `biddaloy_test`, and set `REDIS_URL`).
`server/test/setup.ts` runs migrations and seeds baseline data automatically —
no manual `migration:run`/`seed` step needed.

## Frontend Testing

One Vitest workspace (`vitest.config.ts` at the repo root) covers `shared`,
`ui` and `client-admin` together — separate from `server`'s own Vitest
config and invocation.

```bash
# Watch mode (default) — re-runs only tests affected by what changed
yarn test:frontend

# Single run (CI)
yarn test:frontend --run

# Only tests affected by files changed since origin/main
yarn test:frontend:changed

# A specific file or directory
yarn test:frontend client-admin/src/App.test.tsx

# By test name (regex)
yarn test:frontend -t "renders the admin welcome copy"

# A single package/environment (see below)
yarn test:frontend --project client-admin:jsdom
```

While iterating, use watch mode (`yarn test:frontend`) or the `:changed`
scripts. Repeated full `--run` passes are the slow path, not a safety net —
CI runs the full suite anyway.

Each package has two projects, split by environment:

- **`<pkg>:node`** — `src/**/*.spec.ts`, no DOM. Pure logic: formatting,
  permission resolution, validation, arithmetic. A test here that imports
  React and tries to render it fails outright (`ReferenceError: document is
  not defined`) — there's no DOM in this environment, and that failure *is*
  the boundary between a logic test and a component test, enforced by the
  environment rather than a naming convention someone has to remember.
- **`<pkg>:jsdom`** — `src/**/*.test.{ts,tsx}`, component/hook tests with
  [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/).

`server/vitest.config.ts` is untouched — the two are intentionally separate,
not because they couldn't technically share a workspace, but because the
server's coverage thresholds and setup are its own concern.

### Runner settings (pool, isolation)

[15.3] `vitest.config.ts` sets two runner options, both per-project (a
top-level `test.pool`/`test.isolate` is silently ignored in `projects`
mode — verified the same way `PROJECT_TEST_TIMEOUT`'s own comment already
documents for `testTimeout`):

| Setting | Where | Why |
|---|---|---|
| `pool: 'threads'` | every project | Vitest 4 defaults to `forks` (one OS process per worker). `threads` (worker threads in the same process) measured ~61.7s vs ~69.4s wall locally, coverage off — free, no test-code change. |
| `isolate: false` | `<pkg>:node` and `shared:node`/`scripts:node` only — **not** `:jsdom` | Skips resetting each project's module registry between files. Safe on the `:node` projects because they have zero `vi.mock()` calls between them. **Not** applied to `:jsdom`: those *do* have `vi.mock()` users, and turning this on there reproduces real cross-file contamination — fake timers left running past a file that forgets `vi.useRealTimers()`, and a partial `vi.mock('@biddaloy/ui/api')` in `client-admin/src/main.sentry-wiring.test.ts` that omits `ensureSessionLoaded`, which then breaks unrelated files (`select-school.test.tsx`, `_staff/invoices/$invoiceId.test.tsx`) sharing its worker. Fixing every `vi.mock()` user to tolerate a shared registry is real work across 7 files — not done here, and not yet filed as an issue either; it is the only remaining lever on this ticket's own ~80s target, so it needs filing under epic #428. The `:node` half of the invariant is enforced by `scripts/no-vi-mock-in-node-specs.spec.mjs` so it cannot rot. |

Measured locally (macOS, Node 22, 10 cores, `vitest run --coverage`, the
plus the CI reporter flags — 201 files / 2164 tests, all green on both sides):

| | wall |
|---|---|
| Before (this branch, before [15.3]) | 63.8s |
| After (`pool: threads` + `isolate: false` on `:node` projects) | ~60.5s (3 runs: 60.8s, 60.3s, 60.5s) |

That's a modest local win because `:jsdom` — left isolated — is 153 of the
201 files and dominates the wall clock; see the CI-vs-local caveat below.

### Coverage

```bash
# Runs the full suite with coverage, then opens the HTML report locally
yarn coverage

# Same coverage run without opening a browser (what CI runs)
yarn test:frontend:coverage
```

A global 80% floor (lines, branches, functions and statements) applies
across `ui`, `client-admin` and `shared`; CI fails below it. [15.3] raised
this from 70 — actual coverage on the frontend suite today is statements
90.15%, branches 82.54% (the weakest metric), functions 87.11%, lines
90.80% (`vitest run --coverage`), so a 70 floor sat 12.5-20.8 points under
every real number and could never fire on a realistic regression. 80 sits
~2.5 points under branches, the weakest metric — proven live, not just
present: raising it further to 95 locally and re-running does fail the
build (`ERROR: Coverage for lines (90.8%) does not meet global threshold
(95%)`), confirming the gate actually executes rather than being silently
skipped.
`ui/src/utils/**` and `ui/src/api/**` (the axios client, its interceptors,
and auth/token state) carry a 95% "near-complete" floor instead, on all
four of the same metrics — a bug there means money is wrong or a request
goes out with stale auth. Generated types, `*.stories.{ts,tsx}`, vendored
`ui/src/primitives/`, `ui/src/test/` and framework bootstrap (`main.tsx`)
are excluded from the denominator entirely, not just left unenforced — see
`vitest.config.ts`'s `coverage.exclude`.

CI runs coverage with `--coverage.reporter=text --coverage.reporter=lcovonly`
(`.github/workflows/ci.yml`, the `frontend` job's "Frontend tests with
coverage" step) and uploads just `coverage/lcov.info` as the
`frontend-coverage` artifact, not the full `html` report tree — nothing in
CI opens the HTML report (`scripts/coverage-offenders.mjs` and
`scripts/coverage-delta.mjs` both read only `lcov.info`), and this artifact
is re-downloaded whole on *every* PR run for the baseline diff, so a
smaller artifact is a real, if small, win. `yarn coverage` (local) is
unaffected — `vitest.config.ts`'s own `coverage.reporter` list still
includes `html` for the browser report that command opens.

**CI-vs-local timing divergence:** local numbers above (Node 22, 10 cores)
are directional, not literal CI numbers. The 3 most recent CI runs on
`main` with a green `Frontend tests` job (`gh run list --workflow=ci.yml
--branch=main`, runs `33265595614`, `33252546294`, `33237194595` — cite the
run IDs, not a `--status=success` filter: all three runs concluded *failure*
on an unrelated job, so that filter returns none of them) — all against the
pre-[15.3] suite, since
this is the first PR to touch the runner config — show the "Frontend tests
with coverage" step taking 252s, 276s, and 323s (Node 24, 4 vCPU), far
higher than the ~64s local wall time for the same suite state. Treat any
"under Xs locally" claim about this suite as a floor, not a CI prediction.

## End-to-end Testing (Playwright)

`playwright.config.ts` (repo root) drives a real browser against the real
API and both client SPAs — `e2e/` holds the specs, separate from the
Vitest-based `server/test/*.e2e-spec.ts` suite (`yarn test:e2e`), which
exercises the API directly over HTTP with no browser involved.

Chromium is the only active project today; Firefox and WebKit are commented
out in `playwright.config.ts` rather than deleted, so re-enabling
cross-browser coverage later is an uncomment, not a rewrite.

```bash
# Chromium, headless
yarn e2e

# Inspector with time-travel debugging
yarn e2e --ui

# Step through a single spec — `--debug` alone runs every spec in every
# project, so pin both explicitly
yarn e2e e2e/smoke.spec.ts --project=chromium --debug
```

Bring up Postgres/Redis first, same as any other local dev session — but
point at a dedicated `betonboi_e2e` database rather than your regular dev
one. `playwright.config.ts`'s `webServer` reuses whatever server you
already have running locally (`reuseExistingServer: !CI`), so if that
server is pointed at your normal dev database, `smoke.spec.ts`'s
`page.goto` runs against whatever state your day-to-day use happens to
have left there — "passes locally" stops meaning the same thing as
"passes in CI", which always starts from a fresh `betonboi_e2e`:

```bash
docker compose up -d db redis
createdb -h 127.0.0.1 -U postgres betonboi_e2e   # once, if it doesn't exist yet

DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/betonboi_e2e \
  yarn workspace @biddaloy/server migration:run
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/betonboi_e2e \
  SEED_ADMIN_PASSWORD=<password> yarn workspace @biddaloy/server seed
```

Then start the server itself against that same database before running
`yarn e2e`, so `webServer`'s `reuseExistingServer` picks it up instead of
booting a fresh one against your default dev database:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/betonboi_e2e yarn dev:server
```

`webServer` in `playwright.config.ts` then starts the client itself
(`yarn dev:client-admin`) — or reuses it if
you already have it running in its own terminal, per the
Development section above.

Retries are capped at 1 in CI and 0 locally — a spec that needs more is
hiding flake, not a slow endpoint. Traces, screenshots and video are
captured only on failure and uploaded as CI artifacts (`playwright-report`,
`test-results`); locally they land in the same two gitignored directories
and `yarn e2e --ui` opens the HTML report automatically on failure.

### PWA and offline suite (`yarn e2e:pwa`)

The service worker does not exist in `vite dev` — `client-admin/vite.config.ts`
sets `devOptions: { enabled: false }`, because a dev-server worker would cache
unhashed module URLs and make every later edit look like it did not apply. So
the suite above, which drives the dev server, can never see one. The PWA
suite therefore has its own config that builds the client and serves the real
`dist/` through `vite preview`:

```text
  playwright.config.ts       ──▶ yarn dev:client-admin (:5174) ──▶ no service worker
  playwright.pwa.config.ts   ──▶ vite build + vite preview (:5175) ──▶ real dist/sw.js
```

```bash
# Everything: installability, offline navigation, the update flow,
# the mutation queue, and the tenant-switch purge
yarn e2e:pwa

# One spec
yarn e2e:pwa e2e/pwa/update-flow.spec.ts
```

It reuses the same API and the same seeded database as `yarn e2e`, and runs
serially on a single worker (the update spec rewrites the `dist/sw.js` every
other spec is being served). Reports land in `playwright-report-pwa/` and
`test-results-pwa/`.

Two rules for anything added under `e2e/pwa/`, both of which are easy to get
wrong in a way that leaves a green test proving nothing:

- **Offline is always `context.setOffline()`.** In the pinned Playwright it is
  applied to service-worker targets too, and it fires the `online`/`offline`
  events the app listens to.
- **Never fake offline with `context.route()`,** and never set
  `serviceWorkers: 'block'`. Route interception cannot see requests made by a
  service worker, so a routed "offline" spec passes while the worker quietly
  serves everything from cache.

## CI

Bundle budgets live in `client-admin/scripts/check-route-chunks.mjs` — the
entry-chunk gzip ceiling and its raise history are documented in that file's
header, and every raise happens there, in a PR that says why, referencing the
measured number and the ticket that caused it — never silently. On PRs a
sticky comment (`scripts/bundle-delta.mjs`) shows the per-chunk gzip delta
against the latest `main` build.

`yarn ci:local` (`scripts/ci-local.sh`) reproduces the pipeline locally,
job-for-job with the identical commands, so a CI failure can be replayed
before pushing. The frontend section collects coverage by default — the
same command CI runs; `--no-coverage` is a faster, non-CI-equivalent check.
The service-backed sections self-provision `docker compose up -d db redis`
against a dedicated `biddaloy_ci_local` database. The script and `ci.yml`
cross-reference each other — edit both together.

```mermaid
flowchart LR
    CI["yarn ci:local"] --> verify --> frontend --> audit
    CI -- "--integration" --> integration
    CI -- "--e2e" --> e2e
    CI -- "--lighthouse" --> lighthouse
    CI -- "--full" --> integration & e2e & lighthouse
    CI -. "--no-coverage\n(frontend skips coverage,\nnot CI-equivalent)" .-> frontend
```

Default (`verify` + `frontend` + `audit`) needs no external services and
measured ~1.5 min on a warm checkout; `--full` runs everything (~8–10 min).

### Test timings & budgets

Every `ci.yml` run ends with a **"Test timings & budgets"** job summary —
wall/work/gap, a per-job budget verdict, and the 10 slowest test files —
without opening a single log:

```mermaid
flowchart LR
    R["raw reporter JSON\n(vitest --reporter=json /\nplaywright json reporter)"] -- "ci-timings.mjs collect" --> N["normalized record\nci-timings/<suite>.json"]
    N -- "upload-artifact" --> A["ci-timings-<suite>\nartifact, one per test job"]
    A -- "gh run download\n(this run)" --> D["ci-timings/\n(every artifact, one job)"]
    D -- "ci-timings.mjs summarize" --> S["job summary\n(GITHUB_STEP_SUMMARY)"]
```

Three words, precisely:

- **wall** — last job's `completed_at` minus the first job's `started_at`,
  for the whole run. What a human waits for.
- **work** — the sum of every job's own duration. Billable runner seconds;
  can be (and usually is) far larger than wall, since jobs run in parallel.
- **gap** — wall minus the single longest job's duration. Near zero means
  the pipeline is essentially as parallel as its critical path allows; a
  large gap means something is serializing that doesn't need to.

Example, from a real green PR run: wall 574s, work 1577s, longest job
`E2E (chromium)` 558s, gap 16s — the whole 8-minute wait *is* the e2e job;
nothing else on the critical path is worth optimizing until that changes.
(That sample predates #440's 3-way e2e shard split, which is why it names a
single unsharded `E2E (chromium)` job.)

**Read the per-suite numbers with one caveat.** The `Suites` table and the
top-10 slowest files come from the test runners' own JSON reports, which
time only *test execution* — not module transform, import, or `setupFiles`.
For the frontend suites that is the minority of the real cost: a `ui:node`
run that takes 6.4s of wall clock reports ~1.4s of per-file work, because
setup and imports dominate. So the top-10 reliably ranks files against each
other, but a suite whose slowness lives in its imports will look cheap here.
Use the `Jobs` table (real GitHub job durations) for "what is actually
slow", and the `Suites` table for "which file within a suite".

**Budgets** live in `ci-budgets.json`, next to `knip.json` — one entry per
job (`budgetSeconds`, optional per-job `enforce`), plus a global
`burnIn.enforce` flag. A job with no entry always shows `budget: —` and
never fails — an unlisted or renamed job degrades to "unmeasured", not
"silently blocking". Today every budget warns only (`burnIn.enforce:
false`): an over-budget job shows `⚠️ over by Ns` in the summary and emits
a `::warning::` annotation, but the `timings` job itself stays green. The
same raise protocol as `check-route-chunks.mjs`'s bundle-size ceiling
applies: every budget change happens in a PR that says why, citing the
measured number and the ticket that caused it — never silently.

Locally, `yarn test:timings` runs the frontend suite once and prints the
same wall/work + top-10 table straight to the terminal — no artifact, no
CI, just `scripts/ci-timings.mjs collect` followed by its `report`
subcommand.

A **weekly trend** (`.github/workflows/ci-timings-trend.yml`, Mondays
06:00 UTC) walks the trailing 60 `ci.yml` runs and publishes per-job
median/p90, wall median/p90, and failure rate to the orphan `ci-timings`
git branch (`history/ci-timings.md` / `.json` — generated data with its
own history, not source, so it never touches `main`). It deliberately does
**not** filter runs by `status=success` — failure rate is one of the
tracked series precisely so a red window still shows a real number instead
of a stale one.

**Baseline** (60-run window ending 2026-08-29, see issue #436 for the full
table): median wall 8 min 17s, p90 wall 11 min 54s, failure rate 65%
overall (55% on PRs, 100% on `main` — the `main` red streak is a Lighthouse
assertion failure unrelated to timing, not a flaky pipeline).

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR and on push to
`main`:

- **verify** — install, `yarn build:shared`, `yarn build:server`, `yarn lint`,
  `yarn test:unit`. No infrastructure required. `yarn test:unit:changed`
  runs only the unit tests affected by files changed since `origin/main`.
- **integration** — spins up its own Postgres 16 and Redis 7 service
  containers, then runs `yarn test:integration` and `yarn test:e2e`.
- **e2e** — Chromium only, with its own Postgres/Redis service containers,
  migrated and seeded before Playwright starts the server and both clients.
  See "End-to-end Testing" above.
- **audit** — `node scripts/ci-audit.js`, which gates only on high/critical
  `yarn audit` findings (yarn classic's `--level` flag doesn't affect its exit
  code, so this re-implements the filter correctly). Allowlisted advisories
  are declared inline in the script with a reason and a re-check date.
- **verify** also runs `yarn knip` (dead-code detection) as a **non-blocking**
  step — see below.

### E2E browser policy & sharding

```mermaid
flowchart LR
    PR["PR / push to main\n(ci.yml e2e job)"] --> C["chromium only\n3 shards"]
    N["Nightly, 21:00 UTC\n(nightly-e2e.yml)"] --> CH["chromium\n3 shards"]
    N --> FF["firefox\n3 shards (advisory)"]
    N --> WK["webkit\n3 shards (advisory)"]
```

- **PRs and pushes to `main`** run chromium only, split into 3 shards
  (`ci.yml`'s `e2e` job, matrix `browser × shard`). This is the fast path
  everyone waits on.
- **Nightly** (`.github/workflows/nightly-e2e.yml`, `workflow_dispatch`-able)
  runs all three engines — chromium, firefox, webkit — each split into the
  same 3 shards, on a schedule instead of blocking PRs. The `firefox` and
  `webkit` legs are **advisory**: they carry job-level
  `continue-on-error`, so a red engine shows as a failed job (with its
  report and traces uploaded as `nightly-playwright-report-<browser>-<shard>`)
  while the workflow run itself stays green. They're unproven at repo
  scale — only smoke-tested during #440's planning — and stay advisory
  until a follow-up issue triages and greens them.
- To widen the PR/push path itself to all three engines, set the repo
  Actions variable `E2E_BROWSERS_JSON` to `["chromium","firefox","webkit"]`
  — no workflow edit needed, this has been the contract since #148.
- The shard count (`3`) is **not** defined in one place. It is repeated
  across the job `name:`, the `matrix.shard` list, the "E2E tests" step
  name and its `--shard=${{ matrix.shard }}/3` flag, and — in `ci.yml`
  only — three `matrix.shard == 3` pins that keep the PWA/offline suite
  running exactly once. Changing the count means editing all of them in
  both workflows; the comment above `matrix.shard` in `ci.yml` lists
  them. Get it wrong and CI stays green while tests quietly stop
  running: a `[1, 2]` matrix against `--shard=N/3` just drops the third
  shard's tests, and a stale `== 3` pin silently disables the whole PWA
  suite.
- `yarn e2e` run locally is unsharded and unaffected by any of this.

All specs authenticate via `storageState` fixtures
(`e2e/fixtures/test.ts`'s `loggedIn()`), never by driving the login form —
except the login form's own spec, which has to:

```bash
rg -l "pages/login-page" e2e --glob '*.spec.ts'
# must print exactly:
# e2e/journeys/auth.spec.ts
```

Specs also don't use `waitForTimeout` or serialize on each other — both
should keep returning nothing:

```bash
rg -n "waitForTimeout" e2e/
rg -n "describe\.serial|describe\.configure" e2e/
```

### Flake policy: quarantine, retries, and the nightly hunt

A red run should mean "your change is broken" — not "run it again."

**Baseline (last 59 `ci.yml` runs, 2026-08-26 → 2026-08-29):** 37 failed,
20 succeeded, 2 cancelled — **65% of concluded runs red** (37/57; 63% if
cancelled runs are counted too), well above the 28% the issue assumed.
But the headline number was the wrong instrument.
Classifying all 65 failing *steps* across those 37 runs found exactly one
true, load-sensitive flake shape (an RTL query timing out under CPU load).
Everything else was real: chronic Lighthouse budget misses (16), unit-test
breaks (11), a stale committed `schema.d.ts` (9), broken WIP builds (6).
Most of what looked like flake was a real bug or a real performance
regression wearing a flake costume.

**Target: under 10% of runs red for non-deterministic reasons**, tracked by
the nightly hunt's sticky issue (below) and the per-job durations in the
[Test timings & budgets](#test-timings--budgets) summary. Re-measure with
the same query before claiming an improvement — the rate above counts *all*
red runs, so fixing flake alone will not move it to 10% while Lighthouse
stays chronically over budget.

The policy below treats each of those
three differently on purpose:

```mermaid
flowchart TD
    R["A test fails in CI"] --> Q{"Real bug, real\nregression, or flake?"}
    Q -- "real bug" --> F["Fix it — no shortcut"]
    Q -- "real regression\n(e.g. Lighthouse budget)" --> E["File its own issue —\nquarantining hides it"]
    Q -- "genuinely flaky" --> QT["Add to quarantine.json:\ntest, issue, addedAt, reason"]
    QT --> NB["Runs non-blocking in ci.yml\n(QUARANTINE_MODE=only)"]
    NB --> X{"Fixed inside\n14 days?"}
    X -- yes --> D["Remove the entry"]
    X -- no --> S["quarantine.spec.ts fails the\nblocking frontend job"]
```

- **No blanket retries on unit/component tests.** A retried unit test
  hides a real bug behind a green tick — Vitest has no `retry` option set
  anywhere in this repo, and it should stay that way. If a test only
  passes on the second try, the test (or the code it exercises) is
  broken, not "a bit flaky."
- **Playwright keeps its own retry** (`retries: process.env.CI ? 1 : 0`,
  `playwright.config.ts` / `playwright.pwa.config.ts`) — that is
  browser-level flake (a slow paint, a network jitter under a real
  headless engine), a different class of problem than a unit test's
  logic, and it stays visible: a retried E2E test still shows up in the
  Playwright HTML report as retried, it does not silently disappear.
- **Quarantine is a queue, not a graveyard.** A quarantined test still
  *runs* in CI — just in a separate, non-blocking step
  (`ci.yml`'s "Quarantined frontend tests" step, `QUARANTINE_MODE=only`)
  instead of the gating one — so nobody forgets it exists and it keeps
  reporting whether it's still broken. `ui/src/test/quarantine.spec.ts`
  enforces the queue part: a hard cap of 10 entries and a 14-day expiry,
  both checked in the *blocking* frontend job, so an over-full or stale
  `quarantine.json` fails the pipeline it was supposed to protect.
- **How to quarantine a test:** take the path off the CI `FAIL` line and
  **prefix it with the package directory**, then put that in
  `quarantine.json`'s `test` field with a tracking `issue` number, today's
  date as `addedAt`, and a short `reason`. Vitest prints a path relative to
  the *project* root; the key is relative to the *repo* root, because
  `src/foo.test.tsx` alone is ambiguous between `ui` and `client-admin`.
  The `|client-admin:jsdom|` marker tells you which prefix to add:

  ```text
  FAIL  |client-admin:jsdom| src/routes/portal/fees.test.tsx > /portal/fees > shows the total
  ```

  ```jsonc
  // quarantine.json — note the added "client-admin/" prefix
  {
    "test": "client-admin/src/routes/portal/fees.test.tsx > /portal/fees > shows the total",
    "issue": 123,
    "addedAt": "2026-08-30",
    "reason": "Fails intermittently under CI CPU load"
  }
  ```

  Getting the prefix wrong fails silently — the entry matches nothing and
  the test keeps gating. `scripts/flake-report.mjs`'s nightly output already
  prints keys in the correct repo-relative form, so paste from there when
  you can. See `ui/src/test/quarantine.ts`'s header for the full format.
- **The nightly flake hunt finds candidates for you.**
  `.github/workflows/nightly-frontend-flakes.yml` runs the frontend suite
  three consecutive times every night and diffs the results:
  `scripts/flake-report.mjs` classifies a test as a **flake** (failed at
  least once, passed at least once) or a **real failure** (failed every
  pass — not quarantine material), then the workflow files or updates one
  sticky `flake-hunt`-labelled issue with a table of each, the flaky ones
  already formatted as a `test` value ready to paste into
  `quarantine.json`.

### Dead-code detection (`knip`)

`yarn knip` finds unused files, exports and dependencies across `shared`,
`ui` and `client-admin`. `server` is deliberately excluded
(`ignoreWorkspaces` in `knip.json`) — its NestJS decorators, TypeORM
migrations loaded via glob, and CLI scripts produce enough false positives
from knip's default static-analysis heuristics that a useful config for it is
its own follow-up, not bundled into this one.

`ui`'s public API surface doesn't need per-export suppression: knip reads
entry points straight from `ui/package.json`'s `exports` map, so anything
published there (`./components`, `./hooks`, ...) is automatically treated as
intentionally used. The one manual addition is `src/primitives/**` as an
extra entry glob — those files are vendored shadcn/ui output, staged for a
wrapper in `src/components/` to import later (see `ui/README.md`), so they're
genuinely unreferenced from *inside* this repo until that wrapper exists, not
actually dead.

**Reading a knip report — when it's a false positive:**

- A newly vendored primitive (`ui/src/primitives/*`) showing as unused, or a
  dependency only that primitive uses showing as an unused dependency: not a
  bug, it just hasn't been wrapped yet. Either add it under the `ui` entry in
  `knip.json` (matching the existing `src/primitives/**/*.{ts,tsx}` pattern)
  or leave it — once `src/components/` imports it, knip stops flagging it on
  its own.
- A dependency used only inside a `.css` file's `@import` (e.g. `tailwindcss`
  pulled in transitively through `@biddaloy/ui/styles` rather than a
  client's own stylesheet): knip's static analysis doesn't trace CSS
  `@import` chains across package boundaries. `client-admin`'s
  `ignoreDependencies: ["tailwindcss"]` in `knip.json` documents this
  specific case.
- A dependency declared ahead of the code that will use it (e.g.
  `@biddaloy/ui`'s dependency on `@biddaloy/shared`, or a barrel file's own
  "populated by a later phase-8 task" comment): pre-declared on purpose,
  matching this repo's existing convention of scaffolding empty barrels
  before the feature that fills them lands. Listed in `ignoreDependencies`
  with a comment explaining why, not deleted.
- `biddaloyReactConfig`/`biddaloyPreset` showing as "duplicate exports" in
  `ui/eslint-config.mjs`/`ui/tailwind.preset.ts`: intentional — both files
  export the same value as both a named export and the default, so a
  consumer can use either import style. Suppressed per-file via
  `ignoreIssues` in `knip.json`, not repo-wide.

If a finding doesn't match one of the above, it's very likely real dead code
— delete it rather than reaching for another `ignoreDependencies` entry.

The CI step is **non-blocking** (`continue-on-error: true`) while the config
above is new and unproven; flip it to a hard failure once it's run clean for
a while with no new false-positive categories showing up.

`.github/workflows/codeql.yml` runs CodeQL static analysis (JS/TS) on the same
triggers plus a weekly schedule, reporting to the repo's Security tab.

To reproduce the integration/e2e job locally without the compose stack:

```bash
docker run -d --name pg-test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=biddaloy_test -p 5432:5432 postgres:16-alpine
docker run -d --name redis-test -p 6379:6379 redis:7-alpine

# Wait for both to accept connections — test/setup.ts initializes TypeORM and
# runs migrations immediately, so a container that's merely running but not
# yet ready causes intermittent connection failures.
until docker exec pg-test pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
until docker exec redis-test redis-cli ping > /dev/null 2>&1; do sleep 1; done

cd server
cat > .env.test <<'EOF'
DATABASE_URL=postgres://postgres:postgres@localhost:5432/biddaloy_test
REDIS_URL=redis://localhost:6379
JWT_SECRET=local-test-jwt-secret-do-not-use-in-production-0000000000
SEED_ADMIN_PASSWORD=local-test-password-123
EOF

yarn test:integration
yarn test:e2e
```

## Production Build

```bash
yarn build:all
```

Output is in `build-output/` — a self-contained deployable folder.

## Deploy to VPS

```bash
# On your machine
zip -r deploy.zip build-output/
scp deploy.zip user@your-vps:/opt/biddaloy/

# On the VPS
cd /opt/biddaloy
unzip -o deploy.zip
cp .env.example .env   # Edit with real credentials
./start.sh
```

## Docker Deployment

`docker compose up -d` runs the full stack: `db` (Postgres), `redis`, `app`
(this Nest API + the built SPAs, served statically — see `server/src/main.ts`),
and `nginx` terminating TLS in front of it. A `cert-bootstrap` one-shot service
and a `certbot` renewal-loop service handle certificates.

**Required, not optional, for any real deployment:** the `db` volume must sit
on encrypted storage (a LUKS-encrypted disk, or the cloud provider's
encryption-at-rest, if not self-hosting). `DB_SSL=true` is required
whenever `NODE_ENV=production`, unconditionally — the app refuses to boot
otherwise, regardless of network topology. **This bundled compose file does
not currently configure TLS on the `db` service** — `postgres:16-alpine`
needs a cert/key pair and `ssl=on` to serve it, neither of which this stack
sets up. Deploying this file as-is with `NODE_ENV=production` will fail to
boot until either the `db` service is given real TLS certs, or
`DATABASE_URL` is repointed at an external Postgres that already serves
TLS. See
[`docs/architecture/08-security.md`](docs/architecture/08-security.md#data-protection-transit-at-rest-and-logs)'s
"Data protection" section for the full posture and reasoning.

### DNS prerequisite

Point an A/AAAA record for your domain at the VPS's public IP before starting.
Let's Encrypt's HTTP-01 challenge (what `certbot` uses here) needs to reach
`http://<your-domain>/.well-known/acme-challenge/` from the public internet —
this doesn't work behind NAT without port 80 actually reachable at that domain.

### First-time setup

```bash
cp .env.example .env
# Edit .env: set POSTGRES_USER/PASSWORD/DB, JWT_SECRET, APP_DOMAIN,
# LETSENCRYPT_EMAIL, and CORS_ORIGINS=https://<your-domain>

docker compose up -d
```

On first boot, `cert-bootstrap` generates a short-lived self-signed
certificate (see `nginx/generate-dummy-cert.sh`) so nginx has something to
load — there's no real certificate yet. Confirm the stack is up:

```bash
curl -k https://<your-domain>/api/health
```

Then request the real certificate — a **one-off manual command**, since it
needs a human choosing `--staging` vs. the production endpoint and agreeing to
the ToS. `--entrypoint certbot` is required here: the `certbot` service's own
entrypoint is the renewal loop, not the `certbot` binary directly, so without
it these commands would append `certonly ...` to that loop's shell command
instead of actually running certbot.

```bash
# Certbot won't issue into a `live` directory it doesn't recognize as one of
# its own managed lineages, and cert-bootstrap's dummy cert occupies exactly
# that path — clear it first (see certbot/certbot#9760 for why).
docker compose run --rm --entrypoint sh certbot -c \
  "rm -rf /etc/letsencrypt/live/$APP_DOMAIN /etc/letsencrypt/archive/$APP_DOMAIN /etc/letsencrypt/renewal/$APP_DOMAIN.conf"

# Staging first — the production endpoint rate-limits hard on repeated
# failures, and iterating against it burns your quota fast.
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --staging

# Once that succeeds end-to-end, drop --staging for the real certificate —
# but first delete the staging cert the same way as above, since it's also
# not the lineage the production endpoint will issue.
docker compose run --rm --entrypoint sh certbot -c \
  "rm -rf /etc/letsencrypt/live/$APP_DOMAIN /etc/letsencrypt/archive/$APP_DOMAIN /etc/letsencrypt/renewal/$APP_DOMAIN.conf"
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email

# nginx won't pick up the new cert until it reloads (it self-reloads every
# 6h — see nginx/reload-loop.sh — but you don't want to wait for that now):
docker compose exec nginx nginx -s reload
```

### Renewal

The `certbot` service runs `certbot renew` on a loop (every 12h) and
`nginx` reloads itself every 6h, so a renewed certificate is picked up
automatically without a restart. Nothing else to do.

### Deploying behind an external load balancer instead

If TLS terminates upstream of this stack (a cloud LB, Cloudflare, etc.)
instead of the bundled nginx:

- Don't run the `nginx`, `cert-bootstrap`, or `certbot` services.
- Point the LB at the `app` service's port directly (change `expose` to
  `ports` in `docker-compose.yml`, or route through your platform's service
  discovery).
- `app.set('trust proxy', 1)` in `main.ts` still applies and is correct as
  long as your LB is exactly one hop in front of the app — if there's a
  second proxy in the chain (e.g. LB → nginx → app), change the `1` to match
  the actual hop count, or requests can get a client IP that's spoofable.
- Set `CORS_ORIGINS` to your real public origin(s) regardless of which path
  you use.

## Project Structure

```
biddaloy/
├── server/           # NestJS backend (TypeORM + PostgreSQL)
├── client-admin/     # Vite + React SPA — the whole client: staff routes
│                  #   (/dashboard, /students, …) plus the guardian /portal
├── shared/           # Shared types and DTOs, consumed by server
├── ui/               # Shared React component package, consumed by every client
├── scripts/          # Build and deploy scripts
├── docs/architecture/ # Why the system is built this way — start there for design context
└── build-output/     # Generated: self-contained deployable
```

See [`docs/architecture/00-overview.md`](docs/architecture/00-overview.md)
for the full system diagram and tech stack.
