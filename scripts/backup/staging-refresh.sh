#!/usr/bin/env bash
# Builds tomorrow's staging database from last night's production backup, scrubbed (Epic 79,
# decisions P4, D5, D6, D19, D20, D24). Runs inside the staging `jobs` container, which only sees
# the staging network. It stops at a ready `<POSTGRES_DB>_next`: the host (W3.04) runs migrations
# with the staging app image and then calls db-swap.sh, so this script never needs the app code.
#
#   step 1/7: guard                      POSTGRES_DB must be a staging database
#   step 2/7: wait for daily backup      db/daily/<today>.dump.age, until 02:50 Dhaka
#   step 3/7: create next database
#   step 4/7: download, decrypt, restore (restore.sh)
#   step 5/7: scrub                      scrub.sql, one transaction
#   step 6/7: verify                     schools, users and students are not empty
#   step 7/7: ready                      prints `staging_next ready`
#
# Exit codes: 0 ready, 1 failed (staging is untouched, a `down` push was sent), 2 refused.
#
# Required env:
#   POSTGRES_DB (^biddaloy_staging), POSTGRES_USER, POSTGRES_PASSWORD; POSTGRES_HOST (db), POSTGRES_PORT (5432)
#   BACKUP_S3_ENDPOINT (https), BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
#     The R2 token here must be the READ-ONLY one (D19). This script only ever reads.
#   BACKUP_AGE_PRIVATE_KEY_FILE (default /run/age/key.txt)
#   STAGING_PASSWORD_HASH  bcrypt hash of the shared staging password, made by the caller with the
#                          app's hashPassword (Rule 9). Must start with $2.
#   SMOKE_SCHOOL_SLUG      the school whose users keep their email (D20)
#   PLATFORM_TENANT_ID     uuid of the platform tenant; its super admins keep their email (D6)
# Optional env:
#   STAGING_REFRESH_PUSH_URL    Uptime Kuma push URL. Only failures are pushed here; the `up` push
#                               is sent by the host after the swap and the smoke test.
#   STAGING_REFRESH_DEADLINE    HH:MM Dhaka time to stop waiting for the backup (default 02:50)
#   STAGING_REFRESH_POLL_SECS   seconds between checks (default 60)
#   SCRUB_SQL                   path to scrub.sql (default: next to this script)
#
# Prints step names and counts only, never a person's data. Never `set -x`; never echo a URL,
# a key or the hash. psql and pg_restore messages are filtered because their DETAIL lines can
# contain row values.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STEPS=7
log() { printf 'step %s/%s: %s\n' "$1" "$STEPS" "$2"; }
say() { printf 'staging-refresh.sh: %s\n' "$*" >&2; }

# --- step 1: guard ----------------------------------------------------------------------------
log 1 guard
POSTGRES_DB="${POSTGRES_DB:-}"
if ! [[ "$POSTGRES_DB" =~ ^biddaloy_staging[a-z0-9_]*$ ]] || [[ "$POSTGRES_DB" =~ _(next|prev|prev_old)$ ]]; then
  echo "refusing: not a staging database" >&2
  exit 2
fi
for v in POSTGRES_USER POSTGRES_PASSWORD BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY STAGING_PASSWORD_HASH SMOKE_SCHOOL_SLUG PLATFORM_TENANT_ID; do
  [[ -n "${!v:-}" ]] || { say "$v is required"; exit 2; }
done
[[ "$BACKUP_S3_ENDPOINT" == https://* ]] || { say "BACKUP_S3_ENDPOINT must be https://"; exit 2; }
# shellcheck disable=SC2016  # a literal "$2" prefix, not an expansion
[[ "$STAGING_PASSWORD_HASH" == '$2'* ]] || { say "STAGING_PASSWORD_HASH is not a bcrypt hash"; exit 2; }
[[ "$PLATFORM_TENANT_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || { say "PLATFORM_TENANT_ID is not a uuid"; exit 2; }
[[ "$SMOKE_SCHOOL_SLUG" =~ ^[a-z0-9-]+$ ]] || { say "SMOKE_SCHOOL_SLUG must be lowercase letters, digits and dashes"; exit 2; }
AGE_KEY="${BACKUP_AGE_PRIVATE_KEY_FILE:-/run/age/key.txt}"
[[ -r "$AGE_KEY" ]] || { say "age key not readable"; exit 2; }
SCRUB_SQL="${SCRUB_SQL:-$HERE/scrub.sql}"
[[ -r "$SCRUB_SQL" ]] || { say "scrub.sql not found"; exit 2; }

NEXT="${POSTGRES_DB}_next"
HOST="${POSTGRES_HOST:-db}"
PORT="${POSTGRES_PORT:-5432}"
export PGPASSWORD="$POSTGRES_PASSWORD"
ADMIN_URL="postgres://${POSTGRES_USER}@${HOST}:${PORT}/postgres"
NEXT_URL="postgres://${POSTGRES_USER}@${HOST}:${PORT}/${NEXT}"
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export BACKUP_AGE_PRIVATE_KEY_FILE="$AGE_KEY"

NEXT_CREATED=0
psql_admin() { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -tAqc "$1"; }

push_down() {
  # Same shape as backup.sh's kuma_push: the token is in the path, no query is kept, the URL is
  # never echoed and curl's stderr is discarded. No-op when unset.
  [[ -n "${STAGING_REFRESH_PUSH_URL:-}" ]] || return 0
  local code
  code="$(curl -sS -G --connect-timeout 5 --max-time 10 -o /dev/null -w '%{http_code}' \
    --data-urlencode "status=down" --data-urlencode "msg=$1" \
    "${STAGING_REFRESH_PUSH_URL%%\?*}" 2>/dev/null)" || true
  [[ "$code" == 2* ]] || say "Kuma push got HTTP ${code:-000}, not 2xx"
}

drop_next() {
  # The name matched ^biddaloy_staging at step 1, so quoting it into SQL is safe.
  if [[ $NEXT_CREATED -eq 1 ]]; then
    psql_admin "DROP DATABASE IF EXISTS \"${NEXT}\" WITH (FORCE)" >/dev/null 2>&1 || true
    NEXT_CREATED=0
  fi
}

fail() {
  say "$1"
  drop_next
  push_down "$1"
  exit 1
}

# --- step 2: wait for today's daily backup ----------------------------------------------------
log 2 "wait for daily backup"
# Asia/Dhaka is a fixed UTC+6 (no DST): Dhaka time is epoch + 21600, so this is plain arithmetic
# that works with busybox, GNU and BSD date alike.
DAY="$(TZ=Asia/Dhaka date +%F)"
KEY="db/daily/${DAY}.dump.age"
DEADLINE="${STAGING_REFRESH_DEADLINE:-02:50}"
[[ "$DEADLINE" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || { say "STAGING_REFRESH_DEADLINE must be HH:MM"; exit 2; }
POLL="${STAGING_REFRESH_POLL_SECS:-60}"
[[ "$POLL" =~ ^[1-9][0-9]*$ ]] || { say "STAGING_REFRESH_POLL_SECS must be a positive integer"; exit 2; }
deadline_secs=$((10#${DEADLINE%%:*} * 3600 + 10#${DEADLINE##*:} * 60))

backup_exists() {
  aws s3 ls --endpoint-url "$BACKUP_S3_ENDPOINT" "s3://${BACKUP_S3_BUCKET}/${KEY}" >/dev/null 2>&1
}
while ! backup_exists; do
  dhaka_secs=$((($(date +%s) + 21600) % 86400))
  remaining=$((deadline_secs - dhaka_secs))
  if ((remaining <= 0)); then
    fail "no daily backup for ${DAY}"
  fi
  sleep $((remaining < POLL ? remaining : POLL))
done

# --- step 3: create the next database ---------------------------------------------------------
log 3 "create ${NEXT}"
trap 'drop_next' EXIT
psql_admin "DROP DATABASE IF EXISTS \"${NEXT}\" WITH (FORCE)" >/dev/null || fail "could not clear old ${NEXT}"
psql_admin "CREATE DATABASE \"${NEXT}\"" >/dev/null || fail "could not create ${NEXT}"
NEXT_CREATED=1

# --- step 4: download, decrypt, restore (restore.sh) ------------------------------------------
log 4 "download, decrypt and restore ${KEY}"
RESTORE_LOG="$(mktemp)"
trap 'rm -f "$RESTORE_LOG"; drop_next' EXIT
if ! "$HERE/restore.sh" "$KEY" "$NEXT_URL" --no-migrate >"$RESTORE_LOG" 2>&1; then
  # Only restore.sh's own lines: pg_restore errors can quote row data.
  grep '^restore.sh:' "$RESTORE_LOG" | cut -c1-200 >&2 || true
  fail "restore FAILED"
fi

# --- step 5: scrub ----------------------------------------------------------------------------
log 5 scrub
SCRUB_ERR="$(mktemp)"
trap 'rm -f "$RESTORE_LOG" "$SCRUB_ERR"; drop_next' EXIT
if ! psql "$NEXT_URL" -1 -q -v ON_ERROR_STOP=1 \
  -v "staging_password_hash=${STAGING_PASSWORD_HASH}" \
  -v "smoke_slug=${SMOKE_SCHOOL_SLUG}" \
  -v "platform_tenant_id=${PLATFORM_TENANT_ID}" \
  -f "$SCRUB_SQL" >/dev/null 2>"$SCRUB_ERR"; then
  # First ERROR line only: DETAIL and CONTEXT lines can carry values.
  grep -m1 'ERROR:' "$SCRUB_ERR" | cut -c1-200 >&2 || true
  fail "scrub FAILED"
fi

# --- step 6: verify ---------------------------------------------------------------------------
log 6 verify
for t in schools users students; do
  n="$(psql "$NEXT_URL" -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ${t}" 2>/dev/null)" || n=0
  if ! [[ "$n" =~ ^[0-9]+$ ]] || ((n == 0)); then
    fail "verify FAILED: ${t} is empty"
  fi
  say "${t}: ${n} rows"
done

# --- step 7: ready ----------------------------------------------------------------------------
log 7 ready
NEXT_CREATED=0 # keep it: the host swaps it in
echo "staging_next ready"
