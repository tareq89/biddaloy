# beton-boi

Monorepo: NestJS backend + Vite React clients.

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
for `ui`/`client-admin`/`client-student` source (`scripts/lint-staged-eslint.mjs`
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

# Terminal 2: Student client (HMR)
yarn dev:client-student

# Terminal 3: Admin client (HMR)
yarn dev:client-admin
```

Open http://localhost:5173/student/ for the student client, or the port Vite
prints for `client-admin`, in your browser. Vite proxies `/api/*` requests to
the NestJS server at port 3000.

### Running a client against mocks, no backend

Set `VITE_USE_MOCKS=true` in that client's `.env.local` and skip
`yarn dev:server`/Docker entirely — MSW's browser worker intercepts every
API call instead. See [`ui/README.md`](ui/README.md#mocking-msw) for how
the handler library (populated by [8.4.2]) and the worker itself work.

### Regenerating API types

`ui/src/api/schema.d.ts` is generated from the server's OpenAPI document and
must stay in sync with it (`yarn workspace @beton-boi/ui check:api-types`
enforces this in CI). After changing a server endpoint or DTO:

```bash
yarn api:types
```

This regenerates `server/openapi.json` (`docs:generate`) and then
`ui/src/api/schema.d.ts` from it — see [`ui/README.md`](ui/README.md#api-client)
for what the generated client does with those types.

## Server Testing

```bash
# Server tests
yarn test

# Single run (CI)
yarn workspace @beton-boi/server test:run
```

Unit tests (`yarn test:unit`) need no infrastructure. Integration and e2e tests
need a dedicated Postgres and Redis, and read their config from
`server/.env.test` (gitignored — copy `.env.example`, point `DATABASE_URL` at a
database whose name contains `test`, e.g. `betonboi_test`, and set `REDIS_URL`).
`server/test/setup.ts` runs migrations and seeds baseline data automatically —
no manual `migration:run`/`seed` step needed.

## Frontend Testing

One Vitest workspace (`vitest.config.ts` at the repo root) covers `ui`,
`client-admin` and `client-student` together — separate from `server`'s own
Vitest config and invocation.

```bash
# Watch mode (default) — re-runs only tests affected by what changed
yarn test:frontend

# Single run (CI)
yarn test:frontend --run

# A specific file or directory
yarn test:frontend client-admin/src/App.test.tsx

# By test name (regex)
yarn test:frontend -t "renders the admin welcome copy"

# A single package/environment (see below)
yarn test:frontend --project client-admin:jsdom
```

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
across `ui`, `client-admin` and `client-student`; CI fails below it.
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

`playwright.config.ts` (repo root) drives real browsers against the real
API and both client SPAs — `e2e/` holds the specs, separate from the
Vitest-based `server/test/*.e2e-spec.ts` suite (`yarn test:e2e`), which
exercises the API directly over HTTP with no browser involved.

```bash
# All three browsers, headless
yarn e2e

# Inspector with time-travel debugging
yarn e2e --ui

# Step through a single spec
yarn e2e --debug

# One browser only
yarn e2e --project=chromium
```

Bring up Postgres/Redis first, same as any other local dev session:

```bash
docker compose up -d db redis
yarn workspace @beton-boi/server migration:run
SEED_ADMIN_PASSWORD=<password> yarn workspace @beton-boi/server seed
```

`webServer` in `playwright.config.ts` then starts the server and both
clients itself (`yarn dev:server`, `yarn dev:client-student`,
`yarn dev:client-admin`) — or reuses them if you already have those three
running in their own terminals, per the Development section above.

Retries are capped at 1 in CI and 0 locally — a spec that needs more is
hiding flake, not a slow endpoint. Traces, screenshots and video are
captured only on failure and uploaded as CI artifacts (`playwright-report`,
`test-results`); locally they land in the same two gitignored directories
and `yarn e2e --ui` opens the HTML report automatically on failure.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR and on push to
`main`:

- **verify** — install, `yarn build:shared`, `yarn build:server`, `yarn lint`,
  `yarn test:unit`. No infrastructure required.
- **integration** — spins up its own Postgres 16 and Redis 7 service
  containers, then runs `yarn test:integration` and `yarn test:e2e`.
- **e2e** — Chromium only on every PR/push, with its own Postgres/Redis
  service containers, migrated and seeded before Playwright starts the
  server and both clients. See "End-to-end Testing" above. Firefox and
  WebKit run on demand rather than on every commit — trigger a full sweep
  with:

  ```bash
  gh workflow run CI -f e2e_browsers=chromium,firefox,webkit
  ```

  (or any subset, e.g. `-f e2e_browsers=webkit`). The `e2e-matrix` job
  resolves that input into the actual shard list; unset or omitted, it
  defaults to `chromium`.
- **audit** — `node scripts/ci-audit.js`, which gates only on high/critical
  `yarn audit` findings (yarn classic's `--level` flag doesn't affect its exit
  code, so this re-implements the filter correctly). Allowlisted advisories
  are declared inline in the script with a reason and a re-check date.
- **verify** also runs `yarn knip` (dead-code detection) as a **non-blocking**
  step — see below.

### Dead-code detection (`knip`)

`yarn knip` finds unused files, exports and dependencies across `shared`,
`ui`, `client-admin` and `client-student`. `server` is deliberately excluded
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
  pulled in transitively through `@beton-boi/ui/styles` rather than a
  client's own stylesheet): knip's static analysis doesn't trace CSS
  `@import` chains across package boundaries. `client-admin`'s
  `ignoreDependencies: ["tailwindcss"]` in `knip.json` documents this
  specific case.
- A dependency declared ahead of the code that will use it (e.g.
  `@beton-boi/ui`'s dependency on `@beton-boi/shared`, or a barrel file's own
  "populated by a later phase-8 task" comment): pre-declared on purpose,
  matching this repo's existing convention of scaffolding empty barrels
  before the feature that fills them lands. Listed in `ignoreDependencies`
  with a comment explaining why, not deleted.
- `biddaloyReactConfig`/`betonBoiPreset` showing as "duplicate exports" in
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
  -e POSTGRES_DB=betonboi_test -p 5432:5432 postgres:16-alpine
docker run -d --name redis-test -p 6379:6379 redis:7-alpine

# Wait for both to accept connections — test/setup.ts initializes TypeORM and
# runs migrations immediately, so a container that's merely running but not
# yet ready causes intermittent connection failures.
until docker exec pg-test pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
until docker exec redis-test redis-cli ping > /dev/null 2>&1; do sleep 1; done

cd server
cat > .env.test <<'EOF'
DATABASE_URL=postgres://postgres:postgres@localhost:5432/betonboi_test
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
scp deploy.zip user@your-vps:/opt/beton-boi/

# On the VPS
cd /opt/beton-boi
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
TLS. See the README's "Data protection" section under Security for the
full posture and reasoning.

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

## Security

### Login brute-force protection

`POST /auth/login` layers three controls, defined in
`server/src/modules/auth/`:

- **Per-IP rate limit** — the same `strict` tier (5 requests/60s) used on
  other expensive endpoints (see `rate-limit.ts`).
- **Per-identifier lockout** (`login-attempt.service.ts`) — the normalized
  email/phone is locked out after **5 failed attempts** within a **15-minute
  window**, both Redis-backed and configurable via `LOGIN_LOCKOUT_THRESHOLD`
  and `LOGIN_LOCKOUT_WINDOW_MS`. A successful login resets the counter. The
  lock expires automatically after the window — there is no admin-reset
  path, since a pure admin-reset lock is itself a denial-of-service vector
  against a known account.
- **Progressive delay** — failures before the lockout threshold add an
  increasing delay (500ms per attempt, capped at 2s), to blunt a slow
  distributed attack without hard-locking real users on a couple of typos.

The response body, status, and code path are identical for "no such user",
"wrong password", and "locked out" — `AuthService.validateUser` always runs
`bcrypt.compare` (against a dummy hash when no user is found), so there's no
timing or content difference an attacker could use to enumerate accounts.

Both lockout and the strict rate-limit tier are disabled under
`NODE_ENV=test` — the e2e suite logs in repeatedly against the same seeded
account and would otherwise lock itself out.

### Session & token lifecycle

`POST /auth/login` returns two things: a short-lived (**15 minutes** by
default, `ACCESS_TOKEN_TTL_MS`) bearer access token in the JSON body, and a
long-lived (**30 days** by default, `REFRESH_TOKEN_TTL_MS`) refresh token
set as an `httpOnly`, `__Host-`-prefixed cookie (`server/src/modules/auth/token-cookie.ts`).

**Transport decision:** bearer access token + httpOnly-cookie refresh token,
per the plan in issue #42. This is why the API's CORS config sets
`credentials: true` — it carries a cookie, not just a header — and why
**CSRF protection (issue #48) was real, required work**, not the N/A verdict
it would have been under a pure-bearer design. See "CSRF posture" below for
how that's addressed.

**Rotation and reuse detection** (`server/src/modules/auth/refresh-token.service.ts`):
every refresh token belongs to a rotation "family" started at login. Using a
refresh token invalidates it and issues a new one in the same family
(`POST /auth/refresh`). Presenting an already-used token is treated as
theft — the **entire family is revoked** and a `TOKEN_REUSE_DETECTED` audit
row is written — *unless* it's within a 10-second grace window of its own
rotation, which is treated as two concurrent requests racing on the same
token rather than an attack, and both get a valid fresh pair instead of one
being wrongly logged out.

Refresh tokens are stored as a hash (SHA-256 of a 256-bit random secret,
selector/validator split) — the raw token is never persisted, only ever
seen by the client.

**Revocation:**
- `POST /auth/logout` revokes the presented refresh token. It does **not**
  require a live access token — the access token has likely already expired
  by the time a user gets around to logging out, and that must not block
  revoking the refresh token.
- `POST /auth/logout-all` (requires a valid access token) revokes every
  refresh token for the user and denylists the access token used to call it,
  so that specific session ends immediately rather than riding out its
  remaining ~15-minute lifetime. The denylist
  (`server/src/modules/auth/access-token-denylist.service.ts`) is a Redis
  key per `jti` with a TTL matching the access token's own lifetime — viable
  specifically because that lifetime is now short; this is not a full
  blacklist of every issued token.
- A tenant/role change (`user_tenants`) takes effect on the *next refresh*,
  not after the old token's full lifetime — `POST /auth/refresh` re-fetches
  memberships rather than copying them from the token being replaced.

Expired `refresh_tokens` rows (revoked or not) are deleted by an hourly
BullMQ job (`refresh-token-cleanup.processor.ts`/`.scheduler.ts`).

### CSRF posture

The API splits cleanly into two authentication modes, and the CSRF argument
depends entirely on which one a route uses:

- **Bearer-authenticated routes** — everything except `POST /auth/login`
  and the two cookie-authenticated routes below — read the access token
  from the `Authorization` header. Browsers never attach that header
  automatically to a request they didn't construct, so a cross-site page
  cannot make an authenticated call to these routes no matter what it does
  — there's no ambient credential to ride. This is the vast majority of
  the API and needs no CSRF handling at all; adding blanket CSRF
  middleware here would add token plumbing to every request for zero
  additional protection, which is why there isn't any.
- `POST /auth/login` requires no authentication at all — it's how a client
  obtains a token in the first place, so there's nothing for a cross-site
  request to ride: it can trigger a login with attacker-known credentials,
  but not act as the victim.
- **Cookie-authenticated routes** — `POST /auth/refresh` and
  `POST /auth/logout` — read the refresh cookie, which *is* an ambient
  credential a browser attaches automatically. These are the only routes
  where CSRF is a real question, and they're deliberately layered:
  1. **`SameSite=Strict`** on the cookie (`token-cookie.ts`) is the primary
     defense: the browser simply never attaches it to a cross-site
     request in the first place. This alone closes the practical attack
     for this deployment, where the SPAs are served same-origin by this
     same app (`main.ts`).
  2. **`SameOriginGuard`** (`server/src/modules/auth/guards/same-origin.guard.ts`)
     checks the `Origin` header against the request's own origin as a
     second, independent layer — in case `SameSite` is ever bypassed by a
     legacy browser or a future relaxation to `Lax`. A request with no
     `Origin` header (not something a browser sends for a state-changing
     method) passes through rather than being rejected, since that shape
     of request is outside this check's threat model, not a bypass of it.
  3. The `__Host-` cookie prefix (`token-cookie.ts`) is a related but
     separate guarantee: it stops a compromised sibling origin on the same
     parent domain from ever setting a cookie that shadows this one.
- `POST /auth/logout-all` is bearer-authenticated (`AuthGuard('jwt')`, not
  the cookie) despite being auth-adjacent, so it falls in the first
  category and needs neither of the above.

**The invariant this rests on:** the SPAs are same-origin with the API. If
that ever stops being true — the SPAs move to their own domain/CDN — `Origin`
becomes cross-origin by definition and `SameOriginGuard` needs a real
allowlist (reusing `CORS_ORIGINS`) instead of a same-origin check, and
double-submit CSRF tokens become worth adding on top. Nothing about today's
implementation prevents that; it just isn't needed yet.

### Audit trail

Every significant action — login/logout, a fee-structure edit, an invoice
being generated, a payment received, a reminder sent, a student bulk upload —
is recorded to the write-only `audit_logs` table via a single entry point,
`AuditService.record()` (`server/src/modules/audit/`). No other module holds
a direct repository for this table.

- **Tenant scoping.** `audit_logs.tenant_id` is nullable, unlike other
  tenant-scoped tables: `LOGIN`/`LOGIN_FAILED` can happen against an
  unrecognized identifier *before* a tenant is ever selected, and there is
  genuinely no tenant to attribute that attempt to. Every other action is
  tenant-scoped and always gets one. The admin read endpoint
  (`GET /audit-logs`) is itself tenant-scoped, so an unattributed row simply
  never surfaces on any tenant's trail — that's correct, not a gap.
- **Redaction.** `old_values`/`new_values` are `jsonb` snapshots, recursively
  scrubbed against a denylist (`password_hash`, `token`, `refresh_token`,
  `api_key`, `secret`, `jti`, and variants — see `redact.util.ts`) before
  they're ever written, since the write-only trigger means a bad value here
  can never be corrected after the fact.
- **Transactional vs. ancillary writes.** `record()` takes an optional
  `EntityManager`. Passed one (payment receipt, invoice-from-payment), the
  write participates in the caller's transaction and a failure rolls back
  with it — the audit row is part of the record of truth. Without one
  (login, a fee-structure edit, a reminder send), the write is ancillary to
  an already-decided outcome and fails open (catches, logs, never throws) —
  a DB hiccup on the audit write must not turn a successful action into a
  500.
- **Mechanical CRUD vs. direct calls.** The `@Audited()` decorator +
  `AuditInterceptor` cover the one case where a response body alone is
  enough to write a useful record (`POST /invoices` — a pure create with no
  prior state to diff). Deliberately not a blanket interceptor: an update
  needs old-vs-new diffing the response can't provide (fee-structure
  changes call `AuditService.record()` directly, using the pre-update
  entity already fetched for validation), and a batch send needs one row
  per action rather than one per response (bulk/single reminders do the
  same).

**Retention.** The write-only trigger (`block_audit_logs_write_only`, added
in the initial migration) blocks `UPDATE` and `DELETE` on every row, so a
naive "delete rows older than N days" job cannot work — it would hit the
same trigger a manual edit would. This is documented rather than
implemented, since the table has not yet grown large enough to need it: the
mechanism that respects the write-only guarantee is range partitioning by
`created_at` (e.g. yearly), with old partitions retired via `DROP TABLE`
rather than `DELETE FROM` — a table drop isn't a row-level write the
trigger fires on. An archival job that copies old partitions to cold
storage before dropping them is the natural next step once retention
actually needs enforcing.

### Data protection: transit, at rest, and logs

This app handles student/guardian PII and payment records. The posture below
covers connection security, storage, and what does (and deliberately does
not) get encrypted at the column level.

**Transit to Postgres.** `DATABASE_URL` carries the DB password, and every
query carries whatever PII it touches, over whatever transport TypeORM is
given — a bare TCP socket unless told otherwise. `DB_SSL` (`server/src/db-ssl.ts`)
controls this:

- Unset or not `production`: SSL is off by default (a local docker-compose
  Postgres has none to negotiate), but can still be opted into by setting
  `DB_SSL=true`.
- `NODE_ENV=production`: `DB_SSL` **must** be exactly `"true"` — the app
  refuses to boot otherwise, the same "loud failure beats a silent gap"
  posture as `ENABLE_API_DOCS`'s Basic Auth requirement. Use an
  `sslmode=require`-style `DATABASE_URL` (or the managed provider's
  equivalent) alongside it.
- `DB_SSL_REJECT_UNAUTHORIZED=false` disables certificate verification —
  sometimes genuinely necessary for a managed Postgres with a self-signed
  cert, but logs a boot-time warning every time it's set, since it's also a
  common copy-paste that silently defeats the whole point of enabling TLS.
- This requirement is unconditional — it does not matter whether Postgres
  happens to be on the same private Docker network as the app. The bundled
  `docker-compose.yml`'s `db` service does not configure TLS today, so
  deploying it as-is with `NODE_ENV=production` will refuse to boot until
  that's addressed (see "Docker Deployment" above) — a known gap, not an
  oversight papered over here.

**At rest.** Required as a deployment property, not an optional hardening
step: the Postgres data volume must sit on encrypted storage — either the
self-hosted compose stack's volume backed by a LUKS-encrypted (or
cloud-provider-encrypted) disk, or a managed Postgres with encryption at
rest enabled (the default on every major provider today). There is
currently no automated check for this; it's an operational requirement on
whoever provisions the host/database.

**PII column inventory** (for any future data-subject/erasure request):

| Entity | Column(s) |
|---|---|
| `User` | `email`, `phone`, `full_name`, `password_hash` (bcrypt, already hashed), `profile_picture_url` |
| `Guardian` | `full_name`, `phone`, `alternate_phone`, `email`, `address`, `occupation` |
| `Student` | `full_name`, `date_of_birth`, `gender`, `home_address` |
| `School` | `address`, `phone`, `email` (tenant-level contact info) |
| `RefreshToken` | `ip_address`, `user_agent` |
| `AuditLog` | `ip_address`, `user_agent`, and `old_values`/`new_values` jsonb snapshots — redacted for credentials/tokens (`redact.util.ts`), but can still carry names/emails/phones since those aren't secrets by that redactor's definition |
| `CommunicationLog` | `recipient_address`, `recipient_name`, `message_body` (free text) |
| `Payment` | `remarks` (free text) |
| `Invoice` | `notes` (free text) |

**Column-level encryption: deliberately deferred.** The original ask was to
evaluate encrypting PII columns directly. Evaluated and not done, because it
breaks core access patterns this app depends on:

- Login (`AuthService.validateUser`) looks users up by **exact match** on
  `email`/`phone`. Encrypting those columns makes login impossible without
  a deterministic scheme or a blind index — and a deterministic scheme
  leaks equality anyway (two rows with the same email produce the same
  ciphertext), buying much less protection than it costs in complexity.
- Student/guardian name search and sort are core to every list view.
  Encrypted columns can't be `LIKE`-searched, range-scanned, or usefully
  indexed.
- The threat model volume/managed encryption at rest actually addresses is
  **stolen storage media** — a disk, volume, snapshot, or backup taken
  without valid database credentials. It does *not* protect a `pg_dump`
  (or any other logical export) taken by someone who already has DB
  credentials: Postgres decrypts pages before returning query results, so a
  logical dump is plaintext regardless of what the underlying storage does.
  That scenario is a credential/access-control problem — least-privilege DB
  roles, credential rotation, and the audit trail (#37) — not a storage-
  encryption one, and column-level encryption wouldn't fully close it either
  (an attacker with valid app-level credentials can just query the API).

Neither at-rest volume encryption nor this deferral claims to fully defend
against a compromised, credentialed actor — that requires the access-control
and credential-hygiene work above, not a storage or column-encryption
mechanism.

This would be revisited if either changes: a regulatory requirement forcing
column-level encryption regardless of the login/search cost, or a KMS
becoming available that makes searchable/blind-index encryption practical
without hand-rolling one.

**Logs.** TypeORM's query logger (`server/src/db-logger.ts`) logs query text
but never bound parameters — the default logger appends them as a trailing
`-- PARAMETERS: [...]` comment, which is exactly where an email or phone
passed into a `WHERE` clause would otherwise land in plaintext. The global
exception filter (`AllExceptionsFilter`) redacts email- and phone-shaped
substrings, plus known-sensitive query-param values, from the request URL
and error detail before logging (`common/redact-log.util.ts`) — verified
against a *failing* request, not just a successful one, since the leak is
usually in an error log written under debugging pressure. Request bodies
(the login path carries a plaintext password) are never logged at all.

## API Versioning

All routes are served under `/api/v1/` (`main.ts`'s `enableVersioning`, URI
style — visible in logs, curl-able, cacheable, and trivially routable at
nginx via a broad `location /api/` prefix match, no rewrite needed).
`/api/health` is version-neutral (`@Version(VERSION_NEUTRAL)` on
`AppController.health`) and stays reachable at that exact path regardless of
version bumps, so orchestrator health checks never break on one.

`server/src/api-versioning.ts` is the single place that knows the current
version string, read by both `main.ts` and `server/test/helpers/e2e-app.helper.ts`.
That covers today's single-version setup (every route is `1` by default);
it is **not** by itself enough to run two versions side by side — see below.

### Deprecation policy

Introducing `/api/v2/...` while `/api/v1/...` stays live is not a one-line
change: `enableVersioning`'s `defaultVersion` would need to become `['1',
'2']`, and every route whose v2 behavior differs from v1 needs an explicit
`@Version('1')` (or `'2'`) so the two don't collide on the same handler.
There's no code for this yet — it's written up here so the first real bump
follows a plan instead of improvising one under pressure:

- `/api/v2/...` is added alongside `/api/v1/...` — routes are never removed
  in the same change that adds their replacement.
- `/api/v1/...` stays live for **at least 90 days** after `/api/v2/...`
  ships, giving the first-party SPAs (the only current consumers) a full
  sprint-scale window to migrate.
- Once a removal date is set, deprecated (`/api/v1/...`) responses carry a
  `Deprecation` header per [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html)
  (a structured Unix timestamp, e.g. `Deprecation: @1735689600`) and a
  `Sunset` header per [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html)
  (an HTTP-date, e.g. `Sunset: Thu, 01 Jan 2026 00:00:00 GMT`), so any
  consumer — including a future third-party one — can detect the
  deprecation programmatically without reading docs.
- The bump and its sunset date are announced in this section and in the
  epic/issue tracking the migration — there's no separate public changelog
  yet.

## API Documentation (Swagger)

Interactive docs (`server/src/swagger.ts`, `server/src/docs-auth.ts`) are
reachable at **`/api/docs`** — version-neutral, like `/api/health`, so the
docs URL doesn't move on a version bump. The bearer scheme and the
`X-Tenant-ID`/`X-Role` header contract (see `ApiTenantAuth` in
`server/src/common/decorators/`) are documented on every guarded
controller, so "Try it out" works once you paste in a token.

**Gating** (`shouldMountDocs` in `swagger.ts`):

- Outside production, docs always mount, unauthenticated — nothing sensitive
  about a dev environment's own API shape.
- In production, docs are off by default: the route doesn't exist (a real
  404, not a rejection) unless `ENABLE_API_DOCS=true` is set.
- With `ENABLE_API_DOCS=true` in production, the route is additionally
  gated by Basic Auth (`API_DOCS_USER`/`API_DOCS_PASSWORD`, both required —
  the app refuses to boot with `ENABLE_API_DOCS=true` and no credentials
  set, rather than silently serving the docs unauthenticated).

**Generating a client**: `yarn docs:generate` (from `server/`) writes the
current OpenAPI document to `server/openapi.json`, for the SPAs to generate
a typed client from. This runs `nest build` first and executes the
**compiled** script (`node dist/scripts/generate-openapi.js`), not
`ts-node` — `@nestjs/swagger`'s CLI plugin (`nest-cli.json`'s
`compilerOptions.plugins`), which auto-infers `@ApiProperty()` for DTO/
entity fields from their TypeScript types, only runs through Nest's own
build compiler. Running the script via `ts-node` instead produces a
document with every DTO schema empty — Nest's compiler is what makes the
annotations effectively free instead of a decorator on every one of ~50
DTO classes.

**No sensitive field ever appears in a schema**: `User.password_hash` is
marked `@ApiHideProperty()` directly on the entity, so it's excluded from
every schema that references `User` — including ones no current endpoint
actually returns with that relation populated (Guardian.user, Student.user,
Payment.received_by) — not just the ones a controller happens to sanitize
today. Verified by generating the real document (`yarn docs:generate`) and
confirming zero `password_hash` occurrences; this can't be verified by an
ordinary Vitest test, since the CLI plugin (and therefore the schema
shape) doesn't run under Vitest's SWC-based transform at all.

## Project Structure

```
beton-boi/
├── server/           # NestJS backend (TypeORM + PostgreSQL)
├── client-student/   # Vite + React SPA (student portal)
├── client-admin/     # Vite + React SPA (admin dashboard)
├── client-teacher/   # Future: teacher portal
├── shared/           # Shared types and DTOs, consumed by server
├── ui/               # Shared React component package, consumed by every client
├── scripts/          # Build and deploy scripts
└── build-output/     # Generated: self-contained deployable
```