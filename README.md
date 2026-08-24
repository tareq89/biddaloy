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

### Coverage

```bash
# Runs the full suite with coverage, then opens the HTML report locally
yarn coverage

# Same coverage run without opening a browser (what CI runs)
yarn test:frontend:coverage
```

A global 70% floor (lines, branches, functions and statements) applies
across `ui`, `client-admin` and `shared`; CI fails below it.
`ui/src/utils/**` and `ui/src/api/**` (the axios client, its interceptors,
and auth/token state) carry a 95% "near-complete" floor instead, on all
four of the same metrics — a bug there means money is wrong or a request
goes out with stale auth. Generated types, `*.stories.{ts,tsx}`, vendored
`ui/src/primitives/`, `ui/src/test/` and framework bootstrap (`main.tsx`)
are excluded from the denominator entirely, not just left unenforced — see
`vitest.config.ts`'s `coverage.exclude`.

CI uploads the `lcov`/HTML report as the `frontend-coverage` artifact on
every run (`.github/workflows/ci.yml`), success or failure.

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

## CI

Bundle budgets live in `client-admin/scripts/check-route-chunks.mjs` — the
entry-chunk gzip ceiling and its raise history are documented in that file's
header, and every raise happens there, in a PR that says why, referencing the
measured number and the ticket that caused it — never silently. On PRs a
sticky comment (`scripts/bundle-delta.mjs`) shows the per-chunk gzip delta
against the latest `main` build.

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
