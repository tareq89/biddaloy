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

## Development

Run both server and client in separate terminals:

```bash
# Terminal 1: NestJS server (auto-reload)
yarn dev:server

# Terminal 2: Student client (HMR)
yarn dev:client-student
```

Open http://localhost:5173/student/ in your browser. Vite proxies `/api/*` requests to the NestJS server at port 3000.

## Testing

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

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR and on push to
`main`:

- **verify** — install, `yarn build:shared`, `yarn build:server`, `yarn lint`,
  `yarn test:unit`. No infrastructure required.
- **integration** — spins up its own Postgres 16 and Redis 7 service
  containers, then runs `yarn test:integration` and `yarn test:e2e`.
- **audit** — `node scripts/ci-audit.js`, which gates only on high/critical
  `yarn audit` findings (yarn classic's `--level` flag doesn't affect its exit
  code, so this re-implements the filter correctly). Allowlisted advisories
  are declared inline in the script with a reason and a re-check date.

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

## Project Structure

```
beton-boi/
├── server/           # NestJS backend (TypeORM + PostgreSQL)
├── client-student/   # Vite + React SPA (student portal)
├── client-teacher/   # Future: teacher portal
├── client-admin/     # Future: admin dashboard
├── shared/           # Shared types and DTOs
├── scripts/          # Build and deploy scripts
└── build-output/     # Generated: self-contained deployable
```