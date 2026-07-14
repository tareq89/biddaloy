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