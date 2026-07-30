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

## Docker (future)

```bash
docker compose up -d
```

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