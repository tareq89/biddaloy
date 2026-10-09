#!/usr/bin/env bash
# Local dev setup: start Postgres/Redis/S3 in Docker, build the shared
# package, run migrations, seed demo data. Safe to re-run — migrations skip
# what's already applied and the seed is find-or-create.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env — then edit it."
  exit 1
fi

# Export .env so docker compose, migrations and the seed all see it.
set -a
. ./.env
set +a

# .env.example ships NODE_ENV=production (it doubles as the deploy template).
# The seed refuses to run in production, so local setup is always development.
export NODE_ENV=development

if [ -z "${SEED_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: set SEED_ADMIN_PASSWORD in .env — it becomes the password for admin@school.com."
  exit 1
fi

# The `db` container is created from POSTGRES_*, but the server connects with
# DATABASE_URL. Derive the first from the second so they can never disagree.
# postgres://user:pass@host:port/db?params
db_url="${DATABASE_URL#*://}"
creds="${db_url%@*}"
db_name="${db_url##*/}"
export POSTGRES_USER="${creds%%:*}"
export POSTGRES_PASSWORD="${creds#*:}"
export POSTGRES_DB="${db_name%%\?*}"

echo "==> Starting Postgres, Redis and SeaweedFS (S3)..."
docker compose up -d --wait db redis seaweedfs

echo "==> Building @biddaloy/shared..."
yarn build:shared

echo "==> Running migrations..."
yarn workspace @biddaloy/server migration:run

echo "==> Seeding demo data..."
yarn workspace @biddaloy/server seed

echo "==> Setup done. Log in as admin@school.com with your SEED_ADMIN_PASSWORD."
