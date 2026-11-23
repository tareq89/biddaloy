#!/usr/bin/env bash
# Spin up the Playwright e2e stack and run some or all specs.
#
# Follows the README's "End-to-end Testing (Playwright)" recipe:
# docker Postgres/Redis → dedicated `betonboi_e2e` database → migrate + seed
# (first run) → API server against that database → `playwright test`.
#
# Usage:
#   scripts/e2e.sh                                    # whole suite, chromium
#   scripts/e2e.sh e2e/journeys/marks-sms.spec.ts     # specific spec(s)
#   scripts/e2e.sh -g "send marks SMS"                # any playwright args
#   scripts/e2e.sh --ui                               # inspector
#
# Env overrides:
#   SEED_ADMIN_PASSWORD   seed password (default: the test-env seed password)
#   E2E_DB_NAME           database name (default: betonboi_e2e)
#   E2E_PORT              API port (default: 3000, what playwright.config.ts probes)
set -euo pipefail

cd "$(dirname "$0")/.."

DB_NAME="${E2E_DB_NAME:-betonboi_e2e}"
PORT="${E2E_PORT:-3000}"
# The compose stack's credentials live in the root .env — loaded below —
# never assume the README's "postgres" placeholder.
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-ci-integration-seed-password-123}"
if [ -f .env ]; then
  POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)"
  POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
  SEED_ADMIN_PASSWORD="$(grep -E '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2-)"
fi
export SEED_ADMIN_PASSWORD
# NODE_ENV=test — the same env playwright.config.ts gives its webServer; the
# login throttler is skipped under it, and the suite logs in many times per
# run, so NODE_ENV=development would trip the 5/min rate limit.
export NODE_ENV=test
# register/start echoes the OTP only with this on (CI sets the same job env).
export ACCOUNT_ACCESS_ECHO_SECRETS=true
# The seed creates the platform owner (cockpit specs sign in as it) only with this.
export SEED_COCKPIT_OWNER=true
# The rest of playwright.config.ts's webServer env — since this script starts the
# server first, playwright reuses it and never applies its own env block.
export OUTBOUND_TEST_ALLOW_LOOPBACK=true
export BKASH_TEST_BASE_URL=http://127.0.0.1:38417/v1.2.0-beta
export SITE_ROOT_DOMAIN=sites.e2e.test
PGUSER="${POSTGRES_USER:-postgres}"
export PGPASSWORD="${POSTGRES_PASSWORD:-postgres}"
export DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@127.0.0.1:5432/${DB_NAME}"

# 1. Infra.
docker compose up -d db redis

# 2. Database — create (and remember to seed) only when missing.
fresh=0
# -c query instead of -l: the local psql client may be older than the server
# (PG18) and `-l` selects columns (daticulocale) that don't exist there.
if [ "$(psql -h 127.0.0.1 -U "$PGUSER" -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != "1" ]; then
  createdb -h 127.0.0.1 -U "$PGUSER" "$DB_NAME"
  fresh=1
fi

# 3. Migrate always; seed only a fresh database (the seed is heavy).
yarn workspace @biddaloy/server migration:run
if [ "$fresh" = 1 ]; then
  yarn workspace @biddaloy/server seed
fi

# 4. API server — playwright's `webServer.reuseExistingServer` skips this when
# one is already up, but one started against the dev .env points at the wrong
# database, so probe and start our own when the port is free.
server_pid=""
if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  yarn dev:server &
  server_pid=$!
  for _ in $(seq 1 150); do
    curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || {
    echo "e2e.sh: server did not become healthy on :${PORT}" >&2
    exit 1
  }
fi

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 5. Specs — everything after the script name goes straight to playwright.
# UI mode drives projects from its own filter dropdown, so don't pin chromium
# there: `--project=chromium` on the CLI narrows the UI's file tree.
case " $* " in
  *" --ui "*|*" --debug "*)
    yarn e2e "$@"
    ;;
  *)
    yarn e2e --project=chromium "$@"
    ;;
esac
