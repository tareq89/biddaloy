#!/usr/bin/env bash
# Builds tomorrow's staging database from last night's production backup, scrubbed (Epic 79,
# decisions P4, D5, D6, D19, D20, D24). Runs inside the staging `jobs` container, which only sees
# the staging network. It stops at a ready `<POSTGRES_DB>_next`: the host (W3.04) runs migrations
# with the staging app image and then calls db-swap.sh, so this script never needs the app code.
# With --target (Epic 88) it fills that database itself instead and the caller migrates it.
# WARNING: --target drops and recreates the target first; for biddaloy_staging the caller must
# stop the app (or refuse while it is live), and a failure leaves no target database.
#
#   step 1/7: guard                      POSTGRES_DB must be a staging database
#   step 2/7: wait for daily backup      db/daily/<today>.dump.age, until 02:50 Dhaka
#   step 3/7: create next database
#   step 4/7: download, decrypt, restore (restore.sh)
#   step 5/7: scrub                      scrub.sql, one transaction
#   step 6/7: verify                     schools, users and students are not empty
#   step 7/7: ready                      prints `staging_next ready`
#
# Options (Epic 88, D16):
#   --target <db>   fill this database itself instead of `<POSTGRES_DB>_next`: drop, create, restore,
#                   scrub, verify; no swap. Only `biddaloy_staging` and `biddaloy_staging_drill`.
#   --from <src>    latest-daily (default; waits for today's backup until the deadline),
#                   latest-hourly (newest db/hourly/ object, no wait), or an exact key
#                   `db/daily/<name>.dump.age` / `db/hourly/<name>.dump.age` (no wait).
#
# Exit codes: 0 ready, 1 failed (staging is untouched; a `down` push was sent unless --target), 2 refused.
#
# Required env:
#   POSTGRES_DB (^biddaloy_staging), POSTGRES_USER, POSTGRES_PASSWORD; POSTGRES_HOST (db), POSTGRES_PORT (5432)
#   BACKUP_S3_ENDPOINT (https), BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
#     The R2 token here must be the READ-ONLY one (D19). This script only ever reads.
#   BACKUP_AGE_PRIVATE_KEY_FILE (default /run/age/key.txt)
#   STAGING_PASSWORD_HASH_B64  base64 of the bcrypt cost-12 hash of the shared staging password,
#                          made with the app's hashPassword (Rule 9). base64 because compose expands
#                          every `$` in a .env value; config:check verifies it against STAGING_PASSWORD.
#   SMOKE_SCHOOL_SLUG      the school whose users keep their email (D20)
#   PLATFORM_TENANT_ID     uuid of the platform tenant; its super admins keep their email (D6)
# Optional env:
#   STAGING_REFRESH_PUSH_URL    Uptime Kuma push URL. Only failures are pushed here; the `up` push
#                               is sent by the host after the swap and the smoke test. Never used with
#                               --target: its callers (the nightly drill, biddaloy-staging load) report
#                               the outcome themselves, so a failed hand load never marks the drill down.
#   STAGING_REFRESH_DEADLINE    HH:MM Dhaka time to stop waiting for the backup (default 02:50)
#   STAGING_REFRESH_POLL_SECS   seconds between checks (default 60)
#   STAGING_REFRESH_LOCK        optional lock file; unset = no lock here. The real lock is the host's:
#                               biddaloy-nightly (the host script) holds /opt/biddaloy/deploy.lock and
#                               /run/lock/biddaloy-swap.lock around this container. Set it only
#                               to a path this uid (10001) can write. STAGING_REFRESH_LOCK_WAIT
#                               seconds to wait for it (default 600)
#   SCRUB_SQL                   path to scrub.sql (default: next to this script)
#
# Prints step names and counts only, never a person's data. Never `set -x`; never echo a URL,
# a key or the hash. psql and pg_restore messages are filtered because their DETAIL lines can
# contain row values.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET=""
FROM="latest-daily"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) [[ $# -ge 2 && -n "$2" ]] || { echo "--target needs a database name" >&2; exit 2; }; TARGET="$2"; shift 2 ;;
    --from) [[ $# -ge 2 && -n "$2" ]] || { echo "--from needs a value" >&2; exit 2; }; FROM="$2"; shift 2 ;;
    *) echo "staging-refresh.sh: unknown argument '$1'" >&2; exit 2 ;;
  esac
done
STEPS=7
log() { printf 'step %s/%s: %s\n' "$1" "$STEPS" "$2"; }
say() { printf 'staging-refresh.sh: %s\n' "$*" >&2; }

# --- step 1: guard ----------------------------------------------------------------------------
log 1 guard
POSTGRES_DB="${POSTGRES_DB:-}"
if [[ -n "$TARGET" ]]; then
  # Exact names only: this is the one path that drops a database it was handed on the command line.
  [[ "$TARGET" =~ ^biddaloy_staging(_drill)?$ ]] || { echo "refusing: not a staging database" >&2; exit 2; }
  POSTGRES_DB="$TARGET"
elif ! [[ "$POSTGRES_DB" =~ ^biddaloy_staging[a-z0-9_]*$ ]] || [[ "$POSTGRES_DB" =~ _(next|prev|prev_old)$ ]]; then
  echo "refusing: not a staging database" >&2
  exit 2
fi
case "$FROM" in
  latest-daily | latest-hourly) ;;
  *) [[ "$FROM" =~ ^db/(daily|hourly)/[A-Za-z0-9._:-]+\.dump\.age$ && "$FROM" != *..* ]] || { echo "staging-refresh.sh: --from must be latest-daily, latest-hourly or a db/daily|hourly/<name>.dump.age key" >&2; exit 2; } ;;
esac
for v in POSTGRES_USER POSTGRES_PASSWORD BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY STAGING_PASSWORD_HASH_B64 SMOKE_SCHOOL_SLUG PLATFORM_TENANT_ID; do
  [[ -n "${!v:-}" ]] || { say "$v is required"; exit 2; }
done
[[ "$BACKUP_S3_ENDPOINT" == https://* ]] || { say "BACKUP_S3_ENDPOINT must be https://"; exit 2; }
STAGING_PASSWORD_HASH="$(printf '%s' "$STAGING_PASSWORD_HASH_B64" | base64 -d 2>/dev/null)" || STAGING_PASSWORD_HASH=""
[[ "$STAGING_PASSWORD_HASH" =~ ^\$2[aby]\$12\$[./A-Za-z0-9]{53}$ ]] || { say "STAGING_PASSWORD_HASH_B64 is not a base64 bcrypt cost-12 hash"; exit 2; }
[[ "$PLATFORM_TENANT_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || { say "PLATFORM_TENANT_ID is not a uuid"; exit 2; }
[[ "$SMOKE_SCHOOL_SLUG" =~ ^[a-z0-9-]+$ ]] || { say "SMOKE_SCHOOL_SLUG must be lowercase letters, digits and dashes"; exit 2; }
AGE_KEY="${BACKUP_AGE_PRIVATE_KEY_FILE:-/run/age/key.txt}"
[[ -r "$AGE_KEY" ]] || { say "age key not readable"; exit 2; }
SCRUB_SQL="${SCRUB_SQL:-$HERE/scrub.sql}"
[[ -r "$SCRUB_SQL" ]] || { say "scrub.sql not found"; exit 2; }

# The host script already holds the swap lock around this container (see the header). An extra
# lock is taken only when asked for (the image ships flock).
if [[ -n "${STAGING_REFRESH_LOCK:-}" ]]; then
  exec 9>"$STAGING_REFRESH_LOCK" || { say "cannot open lock file"; exit 2; }
  flock -w "${STAGING_REFRESH_LOCK_WAIT:-600}" 9 || { say "another swap or refresh holds the lock"; exit 1; }
fi

# With --target the work database is the target itself; otherwise tomorrow's `_next`.
if [[ -n "$TARGET" ]]; then NEXT="$TARGET"; else NEXT="${POSTGRES_DB}_next"; fi
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
  [[ -z "$TARGET" && -n "${STAGING_REFRESH_PUSH_URL:-}" ]] || return 0
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

PUSHED=0
fail() {
  say "$1"
  drop_next
  push_down "$1"
  PUSHED=1
  exit 1
}
# Any non-zero exit that did not already push (an unexpected command failure) pushes `down`.
on_exit() {
  local rc=$?
  drop_next
  rm -f "${RESTORE_LOG:-}" "${SCRUB_ERR:-}"
  if [[ $rc -ne 0 && $PUSHED -eq 0 ]]; then push_down "refresh failed at an unexpected step (exit ${rc})"; fi
}
trap on_exit EXIT

# --- step 2: wait for today's daily backup ----------------------------------------------------
log 2 "wait for daily backup"
# Asia/Dhaka is a fixed UTC+6 (no DST): Dhaka time is epoch + 21600, so this is plain arithmetic
# that works with busybox, GNU and BSD date alike.
fmt_epoch() { date -u -d "@$1" "+$2" 2>/dev/null || date -u -r "$1" "+$2"; }
DAY="$(fmt_epoch $(($(date +%s) + 21600)) %F)"
case "$FROM" in
  latest-daily) KEY="db/daily/${DAY}.dump.age" ;;
  latest-hourly | db/*) KEY="" ;;
esac
DEADLINE="${STAGING_REFRESH_DEADLINE:-02:50}"
[[ "$DEADLINE" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || { say "STAGING_REFRESH_DEADLINE must be HH:MM"; exit 2; }
POLL="${STAGING_REFRESH_POLL_SECS:-60}"
[[ "$POLL" =~ ^[1-9][0-9]*$ ]] || { say "STAGING_REFRESH_POLL_SECS must be a positive integer"; exit 2; }
deadline_secs=$((10#${DEADLINE%%:*} * 3600 + 10#${DEADLINE##*:} * 60))

# 0 found, 1 missing (aws prints nothing), 2 aws itself failed (auth, 403, network).
BUCKET_ERROR=0
backup_status() {
  local err rc=0
  err="$(aws s3 ls --endpoint-url "$BACKUP_S3_ENDPOINT" "s3://${BACKUP_S3_BUCKET}/${KEY}" 2>&1 >/dev/null)" || rc=$?
  [[ $rc -eq 0 ]] && return 0
  [[ -z "$err" ]] && return 1
  return 2
}
if [[ "$FROM" == latest-daily ]]; then
  while true; do
    rc=0; backup_status || rc=$?
    [[ $rc -eq 0 ]] && break
    if [[ $rc -eq 2 ]]; then BUCKET_ERROR=1; else BUCKET_ERROR=0; fi
    dhaka_secs=$((($(date +%s) + 21600) % 86400))
    remaining=$((deadline_secs - dhaka_secs))
    if ((remaining <= 0)); then
      [[ $BUCKET_ERROR -eq 0 ]] || fail "cannot read the backup bucket (credentials, permission or network)"
      fail "no daily backup for ${DAY}"
    fi
    sleep $((remaining < POLL ? remaining : POLL))
  done
elif [[ "$FROM" == latest-hourly ]]; then
  listing="$(aws s3 ls --endpoint-url "$BACKUP_S3_ENDPOINT" "s3://${BACKUP_S3_BUCKET}/db/hourly/" 2>/dev/null)" \
    || fail "cannot read the backup bucket (credentials, permission or network)"
  # Key names are UTC timestamps, so the last in sort order is the newest.
  newest="$(awk '{print $NF}' <<<"$listing" | grep '\.dump\.age$' | sort | tail -1 || true)"
  [[ -n "$newest" ]] || fail "no hourly backup found"
  KEY="db/hourly/${newest}"
else
  KEY="$FROM"
  rc=0; backup_status || rc=$?
  [[ $rc -eq 0 ]] || fail "backup ${KEY} not found or bucket unreadable"
fi

# --- step 3: create the next database ---------------------------------------------------------
log 3 "create ${NEXT}"
psql_admin "DROP DATABASE IF EXISTS \"${NEXT}\" WITH (FORCE)" >/dev/null || fail "could not clear old ${NEXT}"
psql_admin "CREATE DATABASE \"${NEXT}\"" >/dev/null || fail "could not create ${NEXT}"
NEXT_CREATED=1

# --- step 4: download, decrypt, restore (restore.sh) ------------------------------------------
log 4 "download, decrypt and restore ${KEY}"
RESTORE_LOG="$(mktemp)"
if ! "$HERE/restore.sh" "$KEY" "$NEXT_URL" --no-migrate >"$RESTORE_LOG" 2>&1; then
  # Only restore.sh's own lines: pg_restore errors can quote row data.
  grep '^restore.sh:' "$RESTORE_LOG" | cut -c1-200 >&2 || true
  fail "restore FAILED"
fi

# --- step 5: scrub ----------------------------------------------------------------------------
log 5 scrub
SCRUB_ERR="$(mktemp)"
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
NEXT_CREATED=0 # keep it: the host swaps it in (or, with --target, it is the destination)
if [[ -n "$TARGET" ]]; then echo "${TARGET} ready"; else echo "staging_next ready"; fi
