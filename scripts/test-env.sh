#!/usr/bin/env bash
# Per-run test infrastructure on the ONE shared local Docker stack.
#
# Every run (a worktree, a pr-fix, a ci:local) reuses the same `biddaloy`
# compose containers (db, redis, seaweedfs) and gets its own slice of them —
# never its own containers:
#
#   Postgres  →  database  biddaloy_test_run_<id>   (+ the _w1.._w4 clones vitest makes)
#   Redis     →  a block of 5 db slots              (base slot + one per vitest worker)
#   SeaweedFS →  bucket    biddaloy-test-run-<id>
#
# Usage:
#   scripts/test-env.sh run -- <cmd...>   up, run <cmd> with the env loaded, then down
#   scripts/test-env.sh up                create this run's slice; prints the env file path
#   scripts/test-env.sh down              remove this run's slice
#   scripts/test-env.sh sweep [hours]     remove slices a crashed run left behind (default: older than 6h)
#
# Multi-step use (env doesn't survive between separate shells, so re-source each time):
#   ENV_FILE=$(scripts/test-env.sh up)
#   set -a; . "$ENV_FILE"; set +a; yarn test:file -- src/x.e2e-spec.ts
#   scripts/test-env.sh down
#
# Run id: $TEST_ENV_RUN_ID, else the checkout's folder name (a worktree's name).
set -euo pipefail

PROJECT=biddaloy
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
MAIN_ROOT="$(dirname "$COMMON_DIR")"
# Inside the shared .git dir, so every worktree sees the same claims.
STATE_DIR="$COMMON_DIR/test-env"
# Base slot (server, seed, Playwright) + 4 vitest workers (vitest.config.ts maxWorkers).
REDIS_BLOCK=5

mkdir -p "$STATE_DIR"

set_names() {
  RUN_ID="$(printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '_' | cut -c1-40)"
  DB_NAME="biddaloy_test_run_${RUN_ID}"
  BUCKET="biddaloy-test-run-$(printf '%s' "$RUN_ID" | tr '_' '-' | sed 's/-*$//')"
  ENV_FILE="$STATE_DIR/$RUN_ID.env"
}
set_names "${TEST_ENV_RUN_ID:-$(basename "$(git rev-parse --show-toplevel)")}"

container() {
  docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1"
}

# One value from a running container's environment (its real credentials).
container_env() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(container "$1")" |
    sed -n "s/^$2=//p"
}

ensure_stack() {
  if [ -n "$(container db)" ] && [ -n "$(container redis)" ] && [ -n "$(container seaweedfs)" ]; then
    return
  fi
  echo "test-env: starting the shared '$PROJECT' stack (db, redis, seaweedfs)..." >&2
  (
    cd "$MAIN_ROOT"
    # Same values `yarn setup` would use. Only matters when the containers
    # don't exist yet; --no-recreate never changes a container that does.
    set -a
    [ -f .env ] && . ./.env
    set +a
    db_url="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/biddaloy}"
    db_url="${db_url#*://}"
    creds="${db_url%@*}"
    db_name="${db_url##*/}"
    export POSTGRES_USER="${POSTGRES_USER:-${creds%%:*}}"
    export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-${creds#*:}}"
    export POSTGRES_DB="${POSTGRES_DB:-${db_name%%\?*}}"
    export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-ci-access-key}"
    export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-ci-secret-key}"
    docker compose -p "$PROJECT" up -d --no-recreate --wait db redis seaweedfs >&2
  )
}

psql_admin() {
  local user
  user="$(container_env db POSTGRES_USER)"
  docker exec -i "$(container db)" psql -U "${user:-postgres}" -d postgres -v ON_ERROR_STOP=1 -tAc "$1"
}

redis_cli() {
  docker exec -i "$(container redis)" redis-cli "$@"
}

weed() {
  echo "$1" | docker exec -i "$(container seaweedfs)" weed shell >/dev/null 2>&1 || true
}

# Prints this run's Redis base slot, claiming a free block if it has none.
# Block 0 (slots 1-5) is never handed out: plain `yarn test:integration` runs
# without test-env use slots 1-4, and slot 0 is the dev server's.
claim_redis_block() {
  local total last k dir
  for dir in "$STATE_DIR"/redis-block-*; do
    if [ -f "$dir/owner" ] && [ "$(cat "$dir/owner")" = "$RUN_ID" ]; then
      echo $((1 + REDIS_BLOCK * ${dir##*-}))
      return
    fi
  done
  total="$(redis_cli CONFIG GET databases | tail -1)"
  last=$(((total - 1) / REDIS_BLOCK - 1))
  # (`seq 1 0` counts DOWN on macOS, so guard the empty case explicitly.)
  [ "$last" -ge 1 ] || last=0
  for k in $(seq 1 "$last" 2>/dev/null | awk -v n="$last" '$1 <= n && $1 >= 1'); do
    # mkdir is atomic: two runs racing for the same block can't both win.
    if mkdir "$STATE_DIR/redis-block-$k" 2>/dev/null; then
      echo "$RUN_ID" >"$STATE_DIR/redis-block-$k/owner"
      echo $((1 + REDIS_BLOCK * k))
      return
    fi
  done
  echo "test-env: all $last Redis slot blocks are in use (redis has $total databases)." >&2
  echo "          Run 'scripts/test-env.sh sweep', or start redis with more --databases." >&2
  return 1
}

flush_redis_block() {
  local base=$1 slot
  for slot in $(seq "$base" $((base + REDIS_BLOCK - 1))); do
    redis_cli -n "$slot" FLUSHDB >/dev/null
  done
}

cmd_up() {
  ensure_stack
  local exists base pg_user pg_pass
  # Claim the Redis block first: it's the only step that can be refused
  # (all blocks busy), and failing here leaves nothing behind.
  base="$(claim_redis_block)"
  flush_redis_block "$base"
  exists="$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")"
  [ "$exists" = 1 ] || psql_admin "CREATE DATABASE \"$DB_NAME\"" >/dev/null
  weed "s3.bucket.create -name $BUCKET"

  pg_user="$(container_env db POSTGRES_USER)"
  pg_pass="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$(container_env db POSTGRES_PASSWORD)")"
  # Infra values come from the real containers; the secrets are the same
  # throwaway, CI-only values .github/workflows/ci.yml uses.
  umask 077
  cat >"$ENV_FILE" <<EOF
BIDDALOY_TEST_ENV=$RUN_ID
DATABASE_URL=postgres://${pg_user:-postgres}:$pg_pass@127.0.0.1:5432/$DB_NAME
REDIS_URL=redis://127.0.0.1:6379/$base
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=$BUCKET
S3_ACCESS_KEY_ID=$(container_env seaweedfs AWS_ACCESS_KEY_ID)
S3_SECRET_ACCESS_KEY=$(container_env seaweedfs AWS_SECRET_ACCESS_KEY)
S3_ALLOW_INSECURE_HTTP=true
S3_FORCE_PATH_STYLE=true
NODE_ENV=test
JWT_SECRET=ci-integration-jwt-secret-do-not-use-in-production-1234567890
SEED_ADMIN_PASSWORD=ci-integration-seed-password-123
SETTINGS_ENCRYPTION_KEY=YmSqNpwxzusjAF12JSD+JNe+3LXrbNJiQza2yTnQyR0=
ACCOUNT_ACCESS_ECHO_SECRETS=true
RATE_LIMIT_DEFAULT_LIMIT=1000
STEP_UP_RATE_LIMIT_MAX_ATTEMPTS=1000
EOF
  echo "$ENV_FILE"
}

cmd_down() {
  local name dir base
  if [ -n "$(container db)" ]; then
    # The run's own database plus the per-worker clones vitest makes from it
    # (biddaloy_test_run_<id>_w1..). Exact names only — never a prefix match.
    for name in $(psql_admin "SELECT datname FROM pg_database WHERE datname = '$DB_NAME' OR datname ~ '^${DB_NAME}_w[0-9]+\$'"); do
      psql_admin "DROP DATABASE \"$name\" WITH (FORCE)" >/dev/null
    done
  fi
  for dir in "$STATE_DIR"/redis-block-*; do
    if [ -f "$dir/owner" ] && [ "$(cat "$dir/owner")" = "$RUN_ID" ]; then
      base=$((1 + REDIS_BLOCK * ${dir##*-}))
      [ -n "$(container redis)" ] && flush_redis_block "$base"
      rm -rf "$dir"
    fi
  done
  [ -n "$(container seaweedfs)" ] && weed "s3.bucket.delete -name $BUCKET"
  rm -f "$ENV_FILE"
  echo "test-env: removed run '$RUN_ID'" >&2
}

cmd_run() {
  [ "${1:-}" = "--" ] && shift
  [ $# -gt 0 ] || { echo "usage: test-env.sh run -- <cmd...>" >&2; exit 2; }
  local env_file status
  env_file="$(cmd_up)"
  trap 'cmd_down || true' EXIT
  trap 'exit 130' INT TERM
  set -a
  . "$env_file"
  set +a
  set +e
  "$@"
  status=$?
  set -e
  exit "$status"
}

cmd_sweep() {
  local hours=${1:-6} f id seen=" "
  # 1. Runs whose env file is older than <hours>: their process is gone.
  for f in "$STATE_DIR"/*.env; do
    [ -e "$f" ] || continue
    if [ -n "$(find "$f" -mmin +$((hours * 60)))" ]; then
      set_names "$(basename "$f" .env)"
      cmd_down
    fi
  done
  # 2. Leftovers with no env file at all (state lost): databases, then Redis claims.
  if [ -n "$(container db)" ]; then
    for id in $(psql_admin "SELECT DISTINCT regexp_replace(substr(datname, 19), '_w[0-9]+\$', '') FROM pg_database WHERE datname LIKE 'biddaloy\\_test\\_run\\_%'"); do
      if [ ! -e "$STATE_DIR/$id.env" ]; then
        set_names "$id"
        cmd_down
      fi
    done
  fi
  for f in "$STATE_DIR"/redis-block-*/owner; do
    [ -e "$f" ] || continue
    id="$(cat "$f")"
    if [ ! -e "$STATE_DIR/$id.env" ]; then
      set_names "$id"
      cmd_down
    fi
  done
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  run) shift; cmd_run "$@" ;;
  sweep) shift; cmd_sweep "$@" ;;
  *)
    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
