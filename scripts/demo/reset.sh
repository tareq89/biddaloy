#!/usr/bin/env bash
# Nightly demo reset: build tomorrow's demo database aside, check it, swap it in by rename.
#
#   1. create biddaloy_demo_next, migrate, seed, validate, sweep   (live DB untouched)
#   2. wait for 02:00 (skipped with --now)
#   3. swap: live -> _prev, _next -> live   (a few seconds of downtime)
#   4. delete the old run's S3 objects, flush Redis, restart the app, Sentry check-in
#
# Any failure before step 3 drops _next and leaves yesterday's demo running. Run by hand with
#   docker compose -f docker-compose.yml -f docker-compose.demo.yml run --rm demo-reset /app/reset.sh --now
#
# SAFETY: this script drops and renames databases. Every such statement goes through
# assert_demo_name (name must be biddaloy_demo*), and the script refuses to start unless
# DEMO_MODE=true and no real SMS / SMTP / push provider is configured (decision D2).
#
# Required env: DEMO_MODE=true, DATABASE_URL (the LIVE demo db, name biddaloy_demo*; the role must
# be able to CREATE/DROP/ALTER databases), REDIS_URL, DEMO_PASSWORD, DEMO_STATE_DIR, S3_BUCKET
# (must contain "demo"), S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
# Optional: DEMO_SCALE (1), DEMO_YEARS (10), DEMO_SWAP_AT (02:00), SENTRY_CRONS_URL,
# DEMO_SWEEP_CMD (run with DEMO_SWEEP_URL set; non-zero = fail) or DEMO_SKIP_SWEEP=true,
# DEMO_RESTART_CMD (default: docker restart $DEMO_APP_CONTAINER), and the DEMO_*_CMD overrides
# below (tests inject fakes there; DEMO_PSQL / DEMO_REDIS_CLI do the same for the two clients).
#
# Secrets discipline: never `set -x`, never echo DATABASE_URL or any key.
set -euo pipefail

log() { printf '%s reset.sh: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
die() { echo "reset.sh: $*" >&2; exit 1; }

DEMO_PSQL="${DEMO_PSQL:-psql}"
DEMO_REDIS_CLI="${DEMO_REDIS_CLI:-redis-cli}"
SWEEP_PORT="${DEMO_SWEEP_PORT:-3999}"
UUID_RE='^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'

# The only names this script may drop or rename. Also makes the name safe to quote into SQL.
assert_demo_name() {
  [[ "$1" =~ ^biddaloy_demo[a-z0-9_]*$ ]] || die "refusing to touch database '$1': name must start with biddaloy_demo"
}

url_for() { printf '%s/%s%s' "$URL_BASE" "$1" "$URL_QUERY"; }

psql_admin() { "$DEMO_PSQL" "$(url_for postgres)" -v ON_ERROR_STOP=1 -tAqc "$1"; }
psql_db() { "$DEMO_PSQL" "$(url_for "$1")" -v ON_ERROR_STOP=1 -tAqc "$2"; }

db_exists() {
  assert_demo_name "$1"
  local found
  found="$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$1'")"
  [[ "$found" == 1 ]]
}
drop_db() { assert_demo_name "$1"; psql_admin "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" >/dev/null; }
rename_db() { assert_demo_name "$1"; assert_demo_name "$2"; psql_admin "ALTER DATABASE \"$1\" RENAME TO \"$2\"" >/dev/null; }
set_connections() { assert_demo_name "$1"; psql_admin "ALTER DATABASE \"$1\" WITH ALLOW_CONNECTIONS $2" >/dev/null; }

cron_checkin() {
  # $1: in_progress | ok | error. No-op when SENTRY_CRONS_URL is unset.
  if [[ -n "${SENTRY_CRONS_URL:-}" ]]; then
    curl -fsS --connect-timeout 5 --max-time 10 -X POST "${SENTRY_CRONS_URL}?status=$1" >/dev/null || true
  fi
}

check_guards() {
  [[ "${DEMO_MODE:-}" == "true" ]] || die "refusing to run: DEMO_MODE is not 'true'"
  local v
  for v in SMS_PROVIDER SMTP_HOST VAPID_PUBLIC_KEY; do
    [[ -z "${!v:-}" ]] || die "refusing to run: $v is set; the demo must not reach a real provider"
  done
  for v in DATABASE_URL REDIS_URL DEMO_PASSWORD DEMO_STATE_DIR S3_BUCKET S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    [[ -n "${!v:-}" ]] || die "$v is required"
  done
  [[ "$S3_BUCKET" == *demo* ]] || die "refusing to run: S3_BUCKET '$S3_BUCKET' does not contain 'demo'"
  if [[ "$S3_ENDPOINT" == http://* && "${S3_ALLOW_INSECURE_HTTP:-}" != "true" ]]; then
    die "S3_ENDPOINT uses http:// - set S3_ALLOW_INSECURE_HTTP=true only for an approved internal endpoint"
  fi
  [[ "$DEMO_SCALE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "DEMO_SCALE must be a number, got '$DEMO_SCALE'"
  [[ "$DEMO_YEARS" =~ ^[1-9][0-9]*$ ]] || die "DEMO_YEARS must be a positive integer, got '$DEMO_YEARS'"
  [[ "$DEMO_SWAP_AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "DEMO_SWAP_AT must be HH:MM, got '$DEMO_SWAP_AT'"
  [[ -n "${DEMO_SWEEP_CMD:-}" || "${DEMO_SKIP_SWEEP:-}" == "true" ]] \
    || die "set DEMO_SWEEP_CMD (the nightly sweep) or DEMO_SKIP_SWEEP=true"

  # DATABASE_URL = postgres://user:pass@host:port/<db>[?query]; <db> is the live demo database.
  [[ "$DATABASE_URL" =~ ^(postgres(ql)?://[^/]+)/([^/?]+)(\?.*)?$ ]] || die "DATABASE_URL has no database name"
  URL_BASE="${BASH_REMATCH[1]}"; LIVE="${BASH_REMATCH[3]}"; URL_QUERY="${BASH_REMATCH[4]:-}"
  assert_demo_name "$LIVE"
  NEXT="${LIVE}_next"; PREV="${LIVE}_prev"; PREV_OLD="${LIVE}_prev_old"
  [[ "$REDIS_URL" =~ ^(redis://[^/]+)(/([0-9]+))?$ ]] || die "REDIS_URL must look like redis://host:port[/db]"
  REDIS_BASE="${BASH_REMATCH[1]}"; REDIS_DB="${BASH_REMATCH[3]:-0}"
}

# Tenant ids (one per line) of the demo branches in a database: their S3 objects live under
# tenants/<id>/. Call as `ids="$(demo_tenant_ids db)"` so a failure stops the run.
demo_tenant_ids() {
  local rows id
  rows="$(psql_db "$1" "SELECT id FROM schools WHERE slug LIKE 'bmsc-%'")"
  while IFS= read -r id; do
    if [[ -z "$id" ]]; then continue; fi
    [[ "$id" =~ $UUID_RE ]] || die "unexpected school id '$id'"
    echo "$id"
  done <<< "$rows"
}

# $1: tenant ids, one per line.
delete_tenant_objects() {
  local id
  while IFS= read -r id; do
    if [[ -z "$id" ]]; then continue; fi
    aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://${S3_BUCKET}/tenants/${id}/" --recursive --only-show-errors
  done <<< "$1"
}

SWAPPED=false
APP_PID=""
OLD_TENANT_IDS=""

on_exit() {
  local rc=$?
  if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; fi
  if [[ $rc -eq 0 ]]; then
    cron_checkin ok
  else
    log "failed with exit code ${rc}"
    if [[ "$SWAPPED" == false ]]; then
      log "swap did not happen: live database is untouched, dropping ${NEXT}"
      local ids
      # Objects the failed seed uploaded under the new tenant ids.
      ids="$(demo_tenant_ids "$NEXT" 2>/dev/null)" || ids=""
      delete_tenant_objects "$ids" || true
      drop_db "$NEXT" || true
    fi
    cron_checkin error
  fi
  exit "$rc"
}

build_next() {
  local url; url="$(url_for "$NEXT")"
  log "creating ${NEXT}"
  drop_db "$NEXT"
  psql_admin "CREATE DATABASE \"${NEXT}\"" >/dev/null
  psql_db "$NEXT" 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"' >/dev/null
  log "migrating ${NEXT}"
  DATABASE_URL="$url" bash -c "$DEMO_MIGRATE_CMD"
  log "seeding ${NEXT} (scale ${DEMO_SCALE}, ${DEMO_YEARS} years)"
  DATABASE_URL="$url" bash -c "$DEMO_SEED_CMD"
  log "validating ${NEXT}"
  DATABASE_URL="$url" bash -c "$DEMO_VALIDATE_CMD" || die "validator found violations in ${NEXT}"
  # A freshly migrated DB holds a random default-school id; DemoBootGuard needs it (see 22-demo-seed.md).
  PLATFORM_ID="$(psql_db "$NEXT" "SELECT id FROM schools WHERE slug = 'default-school'")"
  [[ "$PLATFORM_ID" =~ $UUID_RE ]] || die "no default-school row in ${NEXT}"
}

sweep_next() {
  if [[ "${DEMO_SKIP_SWEEP:-}" == "true" ]]; then log "sweep skipped (DEMO_SKIP_SWEEP=true)"; return; fi
  log "starting a temporary app on :${SWEEP_PORT} against ${NEXT}"
  # Own Redis db so its queue workers never touch the live app's jobs.
  local sweep_redis="${REDIS_BASE}/$((REDIS_DB + 1))"
  PORT="$SWEEP_PORT" DATABASE_URL="$(url_for "$NEXT")" REDIS_URL="$sweep_redis" PLATFORM_TENANT_ID="$PLATFORM_ID" \
    bash -c "$DEMO_APP_CMD" &
  APP_PID=$!
  local i
  for i in $(seq 1 90); do
    if curl -fs "http://127.0.0.1:${SWEEP_PORT}/api/health" >/dev/null 2>&1; then break; fi
    kill -0 "$APP_PID" 2>/dev/null || die "temporary app exited before it was healthy"
    sleep 2
  done
  curl -fs "http://127.0.0.1:${SWEEP_PORT}/api/health" >/dev/null 2>&1 || die "temporary app never became healthy"
  log "running the sweep"
  local rc=0
  DEMO_SWEEP_URL="http://127.0.0.1:${SWEEP_PORT}" bash -c "$DEMO_SWEEP_CMD" || rc=$?
  kill "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=""
  "$DEMO_REDIS_CLI" -u "$sweep_redis" FLUSHDB >/dev/null
  [[ $rc -eq 0 ]] || die "sweep failed (exit ${rc})"
}

wait_for_swap_time() {
  local now secs
  now="$(date +%H:%M:%S)"
  secs=$(( 10#${DEMO_SWAP_AT:0:2} * 3600 + 10#${DEMO_SWAP_AT:3:2} * 60 - 10#${now:0:2} * 3600 - 10#${now:3:2} * 60 - 10#${now:6:2} ))
  if (( secs > 0 )); then log "waiting ${secs}s until ${DEMO_SWAP_AT}"; sleep "$secs"; fi
}

swap() {
  local had_live=false t0 t1
  assert_demo_name "$LIVE"; assert_demo_name "$NEXT"; assert_demo_name "$PREV"; assert_demo_name "$PREV_OLD"
  if db_exists "$LIVE"; then had_live=true; fi
  # Keep exactly one previous DB: _prev becomes _prev_old now, _prev_old is dropped after success.
  drop_db "$PREV_OLD"
  if db_exists "$PREV"; then rename_db "$PREV" "$PREV_OLD"; fi
  t0="$(date +%s)"
  set_connections "$NEXT" false
  if [[ "$had_live" == true ]]; then
    set_connections "$LIVE" false
    psql_admin "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LIVE}' AND pid <> pg_backend_pid()" >/dev/null
    rename_db "$LIVE" "$PREV" || { set_connections "$LIVE" true; die "could not rename ${LIVE}; live database kept"; }
    # Yesterday's database stays usable, so a bad night can be undone by hand (see the runbook).
    set_connections "$PREV" true
  fi
  if ! rename_db "$NEXT" "$LIVE"; then
    if [[ "$had_live" == true ]]; then rename_db "$PREV" "$LIVE" && set_connections "$LIVE" true; fi
    die "could not rename ${NEXT} to ${LIVE}; rolled back"
  fi
  set_connections "$LIVE" true
  t1="$(date +%s)"
  SWAPPED=true
  log "swap done; downtime from backend terminate to reconnect: $((t1 - t0)) s"
  drop_db "$PREV_OLD"
}

main() {
  local now_flag=false
  case "${1:-}" in "") ;; --now) now_flag=true ;; *) die "usage: reset.sh [--now]" ;; esac
  DEMO_SCALE="${DEMO_SCALE:-1}"; DEMO_YEARS="${DEMO_YEARS:-10}"; DEMO_SWAP_AT="${DEMO_SWAP_AT:-02:00}"
  DEMO_MIGRATE_CMD="${DEMO_MIGRATE_CMD:-node_modules/.bin/typeorm migration:run -d server/dist/data-source.js}"
  DEMO_SEED_CMD="${DEMO_SEED_CMD:-node server/dist/scripts/demo-seed/index.js --scale ${DEMO_SCALE} --years ${DEMO_YEARS}}"
  DEMO_VALIDATE_CMD="${DEMO_VALIDATE_CMD:-node server/dist/scripts/demo-seed/validate-cli.js}"
  DEMO_APP_CMD="${DEMO_APP_CMD:-exec node server/dist/main.js}"
  if [[ -z "${DEMO_RESTART_CMD:-}" ]]; then
    DEMO_RESTART_CMD='docker restart "${DEMO_APP_CONTAINER:?DEMO_APP_CONTAINER is required}"'
  fi
  check_guards

  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="$S3_REGION"
  trap on_exit EXIT
  cron_checkin in_progress

  build_next
  sweep_next
  if [[ "$now_flag" == false ]]; then wait_for_swap_time; fi

  if db_exists "$LIVE"; then OLD_TENANT_IDS="$(demo_tenant_ids "$LIVE")"; fi
  swap

  log "deleting old tenant objects from s3://${S3_BUCKET}"
  delete_tenant_objects "$OLD_TENANT_IDS"
  log "flushing Redis db ${REDIS_DB}"
  "$DEMO_REDIS_CLI" -u "$REDIS_URL" FLUSHDB >/dev/null
  # The app reads this file at boot (docker-compose.demo.yml) because default-school's id is new every night.
  printf '%s\n' "$PLATFORM_ID" > "${DEMO_STATE_DIR}/platform-tenant-id.tmp"
  mv "${DEMO_STATE_DIR}/platform-tenant-id.tmp" "${DEMO_STATE_DIR}/platform-tenant-id"
  log "restarting the app"
  bash -c "$DEMO_RESTART_CMD"
  log "done"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
