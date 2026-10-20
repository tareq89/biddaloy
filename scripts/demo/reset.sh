#!/usr/bin/env bash
# Nightly demo reset: build tomorrow's demo database aside, check it, swap it in by rename.
#
#   1. create biddaloy_demo_next, migrate, seed, validate, sweep   (live DB untouched)
#   2. wait for 02:00 (skipped with --now)
#   3. swap: live -> _prev, _next -> live   (a few seconds of downtime)
#   4. re-open live and _prev, write default-school's id, flush Redis, restart  (always attempted)
#   5. drop _prev_old and its S3 objects, Sentry check-in                    (best effort)
#
# Any failure before step 3 drops _next and leaves yesterday's demo running. A failure inside
# step 3 is rolled back, and the log says exactly which state the databases were left in. Only one
# reset runs at a time (flock on $DEMO_STATE_DIR/reset.lock). Run by hand with
#   docker compose -f docker-compose.yml -f docker-compose.demo.yml run --rm demo-reset /app/reset.sh --now
#
# SAFETY: this script drops and renames databases. Every such statement goes through
# assert_demo_name (name must be biddaloy_demo*), and the script refuses to start unless
# DEMO_MODE=true and no real SMS / SMTP / push provider is configured (decision D2).
#
# Required env: DEMO_MODE=true, DATABASE_URL (the LIVE demo db, name biddaloy_demo*; the role must
# be able to CREATE/DROP/ALTER databases), REDIS_URL, DEMO_PASSWORD, DEMO_STATE_DIR, S3_BUCKET
# (a plain bucket name containing "demo"), S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID,
# S3_SECRET_ACCESS_KEY.
# Optional: DEMO_SCALE (1), DEMO_YEARS (10), DEMO_SWAP_AT (02:00), SENTRY_CRONS_URL, DEMO_RESET_PUSH_URL,
# DEMO_SWEEP_CMD (run with DEMO_SWEEP_URL, default http://127.0.0.1:3999 = the temporary app;
# non-zero = fail; killed after DEMO_SWEEP_TIMEOUT seconds, default 1800) or DEMO_SKIP_SWEEP=true,
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
  found="$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$1'")" || die "could not check whether $1 exists"
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
  # Uptime Kuma push monitor `demo-reset-nightly` (12-operations.md section 1): up on ok, down
  # on error. Same shape as backup.sh's kuma_push: the token is in the path, any query is
  # dropped, the URL is never echoed and curl's stderr is discarded. No-op when unset.
  if [[ -n "${DEMO_RESET_PUSH_URL:-}" && "$1" != in_progress ]]; then
    local status=up
    [[ "$1" == ok ]] || status=down
    curl -fsS --connect-timeout 5 --max-time 10 "${DEMO_RESET_PUSH_URL%%\?*}?status=${status}&msg=$1" >/dev/null 2>&1 || true
  fi
}

check_guards() {
  [[ "${DEMO_MODE:-}" == "true" ]] || die "refusing to run: DEMO_MODE is not 'true'"
  local v
  # Every SMS_*, SMTP_* and VAPID_* variable, not only the ones the app reads today.
  for v in $(compgen -v | grep -E '^(SMS|SMTP|VAPID)_' || true); do
    [[ -z "${!v:-}" ]] || die "refusing to run: $v is set; the demo must not reach a real provider"
  done
  for v in DATABASE_URL REDIS_URL DEMO_PASSWORD DEMO_STATE_DIR S3_BUCKET S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    [[ -n "${!v:-}" ]] || die "$v is required"
  done
  [[ "$S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ && "$S3_BUCKET" == *demo* ]] \
    || die "refusing to run: S3_BUCKET '$S3_BUCKET' must be a plain bucket name containing 'demo'"
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
  REDIS_DB="${BASH_REMATCH[3]:-0}"
  # Migrate, seed, validate and the temporary app use the next Redis db, never the live app's jobs.
  (( 10#$REDIS_DB < 15 )) || die "REDIS_URL db must be below 15 (the build uses the next one), got ${REDIS_DB}"
  SWEEP_REDIS="${BASH_REMATCH[1]}/$((10#$REDIS_DB + 1))"
}

# Tenant ids (one per line) of the demo branches in a database: their S3 objects live under
# tenants/<id>/. None for a database that does not exist. Returns non-zero on a psql error, so
# `ids="$(demo_tenant_ids db)"` stops the run (bash drops errexit inside $(...), hence the checks).
demo_tenant_ids() {
  local rows id has
  db_exists "$1" || return 0
  # A _next stopped mid-swap refuses connections, and the query below needs one.
  set_connections "$1" true || return 1
  has="$(psql_db "$1" "SELECT to_regclass('public.schools') IS NOT NULL")" || return 1
  [[ "$has" == t ]] || return 0  # a build that died before migrating has no schools
  rows="$(psql_db "$1" "SELECT id FROM schools WHERE slug LIKE 'bmsc-%'")" || return 1
  while IFS= read -r id; do
    if [[ -z "$id" ]]; then continue; fi
    [[ "$id" =~ $UUID_RE ]] || die "unexpected school id '$id'"
    echo "$id"
  done <<< "$rows"
}

# $1: tenant ids, one per line. Tries every id; non-zero if any delete failed.
delete_tenant_objects() {
  local id rc=0
  while IFS= read -r id; do
    if [[ -z "$id" ]]; then continue; fi
    aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://${S3_BUCKET}/tenants/${id}/" --recursive --only-show-errors || rc=1
  done <<< "$1"
  return "$rc"
}

# Deletes a demo database's S3 objects, then drops it. Objects live exactly as long as their DB, so
# restoring _prev by hand (see the runbook) brings back a demo whose files still exist. A failed
# delete keeps the database, and with it the ids, so the next run retries instead of leaking.
purge_db() {
  local ids
  ids="$(demo_tenant_ids "$1")" || return 1
  delete_tenant_objects "$ids" || return 1
  drop_db "$1"
}

# Both are set just BEFORE their rename; recover() asks the catalog whether the rename committed.
SWAPPED=false     # _next -> live was attempted
LIVE_MOVED=false  # live -> _prev was attempted
SWAP_T0=""
APP_PID=""

# Run from on_exit in a subshell: puts the databases in the safest state it can, and logs which.
recover() {
  local manual="fix by hand, runbook in docs/architecture/22-demo-seed.md"
  if [[ "$SWAPPED" == true ]] && db_exists "$LIVE" && ! db_exists "$NEXT"; then
    set_connections "$LIVE" true || { log "the new ${LIVE} refuses connections: ${manual}"; return 1; }
    log "the new database is live; a step after the swap failed (see above)"
    return 0
  fi
  if [[ "$LIVE_MOVED" == true ]] && ! db_exists "$LIVE"; then
    rename_db "$PREV" "$LIVE" || { db_exists "$LIVE" && ! db_exists "$PREV"; } \
      || { log "ROLLBACK FAILED: yesterday's database is ${PREV}, there is no ${LIVE}, ${NEXT} is kept: ${manual}"; return 1; }
    log "rolled back: yesterday's database is ${LIVE} again"
  fi
  if db_exists "$LIVE"; then
    set_connections "$LIVE" true || { log "${LIVE} refuses connections: ${manual}"; return 1; }
    log "swap did not happen: ${LIVE} is yesterday's database and accepts connections"
  else
    log "there is no ${LIVE}: ${manual}"
  fi
  log "dropping ${NEXT} and the objects its seed uploaded"
  purge_db "$NEXT" || { log "could not purge ${NEXT}; the next run retries"; return 1; }
}

on_exit() {
  local rc=$?
  # Back to the real stdout/stderr: an errexit inside `cmd >/dev/null` runs this trap with that
  # redirection still active, which would swallow every line below.
  exec 1>&3 2>&4
  if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; fi
  if [[ $rc -eq 0 ]]; then cron_checkin ok; exit 0; fi
  log "failed with exit code ${rc}"
  ( recover ) || log "recovery did not finish (see above)"
  "$DEMO_REDIS_CLI" -u "$SWEEP_REDIS" FLUSHDB >/dev/null 2>&1 || true
  cron_checkin error
  exit "$rc"
}

build_next() {
  local url; url="$(url_for "$NEXT")"
  log "creating ${NEXT}"
  purge_db "$NEXT" || die "could not purge a leftover ${NEXT}; it is kept for the next run"
  psql_admin "CREATE DATABASE \"${NEXT}\"" >/dev/null
  psql_db "$NEXT" 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"' >/dev/null
  log "migrating ${NEXT}"
  DATABASE_URL="$url" REDIS_URL="$SWEEP_REDIS" bash -c "$DEMO_MIGRATE_CMD" 9>&-
  log "seeding ${NEXT} (scale ${DEMO_SCALE}, ${DEMO_YEARS} years)"
  DATABASE_URL="$url" REDIS_URL="$SWEEP_REDIS" bash -c "$DEMO_SEED_CMD" 9>&-
  log "validating ${NEXT}"
  DATABASE_URL="$url" REDIS_URL="$SWEEP_REDIS" bash -c "$DEMO_VALIDATE_CMD" 9>&- || die "validator found violations in ${NEXT}"
  # A freshly migrated DB holds a random default-school id. The app's PLATFORM_TENANT_ID must name
  # it (TenantStatusService.platformTenantId(): platform authority), so main() hands it over.
  PLATFORM_ID="$(psql_db "$NEXT" "SELECT id FROM schools WHERE slug = 'default-school'")" || die "could not read default-school"
  [[ "$PLATFORM_ID" =~ $UUID_RE ]] || die "no default-school row in ${NEXT}"
}

sweep_next() {
  if [[ "${DEMO_SKIP_SWEEP:-}" == "true" ]]; then log "sweep skipped (DEMO_SKIP_SWEEP=true)"; return; fi
  log "starting a temporary app on :${SWEEP_PORT} against ${NEXT}"
  # The runner shares this container's network namespace and uses http://127.0.0.1:3999 (loopback
  # keeps the Secure session cookie over plain HTTP). Not published to the host. 9>&- so it never
  # holds the reset lock.
  PORT="$SWEEP_PORT" DATABASE_URL="$(url_for "$NEXT")" REDIS_URL="$SWEEP_REDIS" PLATFORM_TENANT_ID="$PLATFORM_ID" \
    bash -c "$DEMO_APP_CMD" 9>&- &
  APP_PID=$!
  for _ in $(seq 1 90); do
    if curl -fs --max-time 5 "http://127.0.0.1:${SWEEP_PORT}/api/health" >/dev/null 2>&1; then break; fi
    kill -0 "$APP_PID" 2>/dev/null || die "temporary app exited before it was healthy"
    sleep 2
  done
  curl -fs --max-time 5 "http://127.0.0.1:${SWEEP_PORT}/api/health" >/dev/null 2>&1 || die "temporary app never became healthy"
  log "running the sweep"
  local rc=0
  # 9>&-: a runner child that outlives the timeout must not keep the reset lock.
  DEMO_SWEEP_URL="${DEMO_SWEEP_URL:-http://127.0.0.1:${SWEEP_PORT}}" \
    timeout "${DEMO_SWEEP_TIMEOUT:-1800}" bash -c "$DEMO_SWEEP_CMD" 9>&- || rc=$?
  kill "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=""
  [[ $rc -eq 0 ]] || die "sweep failed (exit ${rc})"
}

wait_for_swap_time() {
  local now secs
  now="$(date +%H:%M:%S)"
  secs=$(( 10#${DEMO_SWAP_AT:0:2} * 3600 + 10#${DEMO_SWAP_AT:3:2} * 60 - 10#${now:0:2} * 3600 - 10#${now:3:2} * 60 - 10#${now:6:2} ))
  if (( secs > 0 )); then log "waiting ${secs}s until ${DEMO_SWAP_AT}"; sleep "$secs"; fi
}

# Any failure here exits; on_exit -> recover() reads the catalog to roll back.
swap() {
  assert_demo_name "$LIVE"; assert_demo_name "$NEXT"; assert_demo_name "$PREV"; assert_demo_name "$PREV_OLD"
  # Keep exactly one previous DB: _prev becomes _prev_old now, and _prev_old is purged once the app
  # is back. A _prev_old found here is left over from a failed night.
  purge_db "$PREV_OLD" || log "could not purge leftover ${PREV_OLD}; continuing"
  if db_exists "$PREV"; then
    if ! db_exists "$PREV_OLD"; then rename_db "$PREV" "$PREV_OLD"
    # The leftover's objects could not be deleted, so it stays for the next night to retry, and
    # _prev (due to be purged tonight anyway) goes now instead of being renamed onto it.
    else purge_db "$PREV" || die "could not purge ${PREV} either; nothing renamed, swap skipped"; fi
  fi
  SWAP_T0="$(date +%s)"
  set_connections "$NEXT" false
  if db_exists "$LIVE"; then
    set_connections "$LIVE" false
    psql_admin "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LIVE}' AND pid <> pg_backend_pid()" >/dev/null
    LIVE_MOVED=true
    rename_db "$LIVE" "$PREV"
  fi
  SWAPPED=true
  # psql can report an error for a rename that did commit (connection lost on the reply): the
  # catalog decides, so a committed swap always goes on to the post-swap steps in main().
  rename_db "$NEXT" "$LIVE" \
    || { db_exists "$LIVE" && ! db_exists "$NEXT" && log "psql reported an error, but ${NEXT} is now ${LIVE}"; } \
    || die "could not rename ${NEXT} to ${LIVE}"
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

  # One reset at a time, across the cron container and any `run --rm` copy (same demo-state volume).
  # Taken before the EXIT trap, so a refused second run never drops the first run's _next.
  exec 9>"${DEMO_STATE_DIR}/reset.lock"
  flock -n 9 || die "another reset is running (${DEMO_STATE_DIR}/reset.lock is held); not starting"

  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="$S3_REGION"
  exec 3>&1 4>&2
  trap on_exit EXIT
  cron_checkin in_progress

  local state="${DEMO_STATE_DIR}/platform-tenant-id" first_run=false failed="" out
  [[ -s "$state" ]] || first_run=true

  build_next
  sweep_next
  "$DEMO_REDIS_CLI" -u "$SWEEP_REDIS" FLUSHDB >/dev/null
  if [[ "$now_flag" == false ]]; then wait_for_swap_time; fi

  swap

  # From here every step is attempted even if an earlier one failed: the app must come back on the
  # new database. Order: connections, the id file the app reads at boot, a clean Redis, the restart.
  if set_connections "$LIVE" true; then
    log "swap done; downtime from backend terminate to reconnect: $(( $(date +%s) - SWAP_T0 )) s"
  else failed+=" live-connections"; fi
  # Yesterday's database stays usable, so a bad night can be undone by hand (see the runbook).
  # Opened only now: a rollback rename needs it free of sessions.
  if [[ "$LIVE_MOVED" == true ]]; then set_connections "$PREV" true || failed+=" prev-connections"; fi
  { printf '%s\n' "$PLATFORM_ID" > "${state}.tmp" && mv "${state}.tmp" "$state"; } || failed+=" state-file"
  log "flushing Redis db ${REDIS_DB}"
  "$DEMO_REDIS_CLI" -u "$REDIS_URL" FLUSHDB >/dev/null || failed+=" redis-flush"
  log "restarting the app"
  if ! out="$(bash -c "$DEMO_RESTART_CMD" 2>&1 9>&-)"; then
    printf '%s\n' "$out" >&2
    # First boot: `app` was never created (docker-compose.demo.yml header). Any other error counts.
    if [[ "$first_run" == true && "$out" == *"No such container"* ]]; then
      log "app not restarted: first run, start it with docker compose up"
    else failed+=" app-restart"; fi
  fi
  log "dropping ${PREV_OLD} and its S3 objects"
  purge_db "$PREV_OLD" || failed+=" purge-${PREV_OLD}"
  [[ -z "$failed" ]] || die "swapped, but these steps failed:${failed}"
  log "done"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
