#!/usr/bin/env bash
# Weekly restore drill (runs in the backup container, Sunday 03:30 Asia/Dhaka;
# by hand: `docker compose exec backup /app/drill.sh`).
#
# Restores the newest R2 dump (db/hourly/) into a scratch database on the same
# Postgres, compares per-table row counts with the live database, checks one
# random uploaded file round-trips through the rclone crypt remote, drops the
# scratch database, and pushes up/down to Uptime Kuma (DRILL_PUSH_URL).
#
# Pass = for every verify.sql table, drill count <= live count (data moved on
# since the dump) and drill > 0 whenever live > 0.
#
# Required env: DATABASE_URL (live; read only), BACKUP_AGE_PRIVATE_KEY_FILE,
# S3_* (live files bucket), all six BACKUP_S3_* / BACKUP_RCLONE_CRYPT_* (R2).
# Optional env: DRILL_DATABASE_URL (default: <DATABASE_URL minus db name>/biddaloy_drill;
# its database name must contain "drill"), DRILL_ADMIN_URL (default: .../postgres),
# DRILL_PUSH_URL, S3_ALLOW_INSECURE_HTTP.
#
# Secrets discipline: never `set -x`, never echo a URL, key or credential.
set -euo pipefail

CURRENT_STEP="config"
TMP=""
DRILL_DB=""
TABLES=0

kuma_push() {
  # $1 up|down, $2 message (a step name or a count, never a secret).
  if [[ -n "${DRILL_PUSH_URL:-}" ]]; then
    local base="${DRILL_PUSH_URL%%\?*}"
    curl -fsS --connect-timeout 5 --max-time 10 "${base}?status=${1}&msg=${2}" >/dev/null 2>&1 || true
  fi
}

on_exit() {
  local code=$?
  # Always remove the scratch database, pass or fail (only once it is set and
  # has passed the name guard below).
  # A drop that fails after a passing run is still a red drill: a full copy of
  # prod would sit in the cluster until next week.
  if [[ -n "$DRILL_DB" ]]; then
    if ! psql "$DRILL_ADMIN_URL" -qAtc "DROP DATABASE IF EXISTS \"${DRILL_DB}\" WITH (FORCE)" >/dev/null 2>&1; then
      echo "drill.sh: could not drop scratch database ${DRILL_DB}" >&2
      if [[ $code -eq 0 ]]; then CURRENT_STEP="drop-db"; code=1; fi
    fi
  fi
  if [[ $code -eq 0 ]]; then
    kuma_push up "ok-${TABLES}-tables"
  else
    echo "drill.sh: failed at step '${CURRENT_STEP}' with exit code ${code}" >&2
    kuma_push down "$CURRENT_STEP"
  fi
  if [[ -n "$TMP" ]]; then rm -rf "$TMP"; fi
  exit "$code"
}

# One drill at a time: a manual run during the cron run would drop the other
# run's scratch database mid-restore. Taken before the trap, so a refused second
# run pushes nothing.
exec 9>"${TMPDIR:-/tmp}/drill.lock"
if ! flock -n 9; then
  echo "drill.sh: another drill is already running" >&2
  exit 1
fi
trap on_exit EXIT

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_PRIVATE_KEY_FILE:?BACKUP_AGE_PRIVATE_KEY_FILE is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is required}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is required}"
: "${BACKUP_RCLONE_CRYPT_PASSWORD:?BACKUP_RCLONE_CRYPT_PASSWORD is required}"
: "${BACKUP_RCLONE_CRYPT_SALT:?BACKUP_RCLONE_CRYPT_SALT is required}"
if [[ ! -f "$BACKUP_AGE_PRIVATE_KEY_FILE" || ! -r "$BACKUP_AGE_PRIVATE_KEY_FILE" ]]; then
  echo "drill.sh: BACKUP_AGE_PRIVATE_KEY_FILE is not a readable file (host file must exist and be readable by uid 10001)" >&2
  exit 1
fi
if [[ "$BACKUP_S3_ENDPOINT" != https://* ]]; then
  echo "drill.sh: BACKUP_S3_ENDPOINT must be https://" >&2
  exit 1
fi
if [[ "$S3_ENDPOINT" == http://* && "${S3_ALLOW_INSECURE_HTTP:-}" != "true" ]]; then
  echo "drill.sh: S3_ENDPOINT uses http:// — set S3_ALLOW_INSECURE_HTTP=true only for an approved local/dev endpoint" >&2
  exit 1
fi

# Scratch database guards. The name must say "drill" and the URL must not be
# the live one, so a typo can never point DROP DATABASE at production.
# ponytail: DATABASE_URL is assumed to have no ?query; add parsing if it gains one.
DRILL_BASE="${DATABASE_URL%/*}"
DRILL_DATABASE_URL="${DRILL_DATABASE_URL:-${DRILL_BASE}/biddaloy_drill}"
DRILL_ADMIN_URL="${DRILL_ADMIN_URL:-${DRILL_DATABASE_URL%/*}/postgres}"
if [[ "$DRILL_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "drill.sh: refusing — DRILL_DATABASE_URL matches DATABASE_URL (the live database)" >&2
  exit 1
fi
name="${DRILL_DATABASE_URL%%\?*}"; name="${name##*/}"
if ! [[ "$name" =~ ^[a-z0-9_]*drill[a-z0-9_]*$ ]]; then
  echo "drill.sh: refusing — scratch database name must contain 'drill' and use only [a-z0-9_]" >&2
  exit 1
fi

TMP="$(mktemp -d)"
HERE="$(cd "$(dirname "$0")" && pwd)"

# aws against R2 by default; live_aws against the live files bucket.
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
live_aws() {
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" aws --endpoint-url "$S3_ENDPOINT" "$@"
}

CURRENT_STEP="find-dump"
key="$(aws s3api list-objects-v2 --endpoint-url "$BACKUP_S3_ENDPOINT" \
  --bucket "$BACKUP_S3_BUCKET" --prefix "db/hourly/" \
  --query 'sort_by(Contents,&Key)[-1].Key' --output text)"
if [[ -z "$key" || "$key" == "None" ]]; then
  echo "drill.sh: no dump found under db/hourly/" >&2
  exit 1
fi
echo "drill.sh: newest dump is ${key}"

CURRENT_STEP="disk"
# The scratch database, the decrypted dump (restore.sh, in $TMPDIR) and the live
# database share one disk on a single VM. A drill that fills it would take live
# Postgres down, so ask for ~2.5x the live size free first.
# ponytail: one df on $TMPDIR stands in for the Postgres volume too (same disk
# on one VM); check the volume separately if the data root ever moves.
live_bytes="$(psql "$DATABASE_URL" -qAtc 'SELECT pg_database_size(current_database())')"
free_kb="$(df -Pk "${TMPDIR:-/tmp}" | awk 'NR==2 {print $4}')"
if (( free_kb * 1024 < live_bytes * 5 / 2 )); then
  echo "drill.sh: not enough free disk (${free_kb} KiB free, live database ${live_bytes} bytes)" >&2
  exit 1
fi

CURRENT_STEP="create-db"
DRILL_DB="$name"
psql "$DRILL_ADMIN_URL" -qAtc "DROP DATABASE IF EXISTS \"${DRILL_DB}\" WITH (FORCE)" >/dev/null
psql "$DRILL_ADMIN_URL" -qAtc "CREATE DATABASE \"${DRILL_DB}\"" >/dev/null

CURRENT_STEP="restore"
bash "$HERE/restore.sh" "$key" "$DRILL_DATABASE_URL" --no-migrate >"$TMP/restore.log" 2>&1 \
  || { tail -n 5 "$TMP/restore.log" >&2; exit 1; }

CURRENT_STEP="counts"
psql "$DRILL_DATABASE_URL" -q -f "$HERE/verify.sql" -t -A -F',' 2>/dev/null >"$TMP/drill.csv"
psql "$DATABASE_URL" -q -f "$HERE/verify.sql" -t -A -F',' 2>/dev/null >"$TMP/live.csv"
TABLES="$(awk -F, '
  NR==FNR { live[$1]=$2; next }
  { n++
    if (!($1 in live) || $2+0 > live[$1]+0 || ($2+0 == 0 && live[$1]+0 > 0)) {
      printf "drill.sh: count mismatch on table %s (drill %s, live %s)\n", $1, $2, ($1 in live ? live[$1] : "missing") > "/dev/stderr"
      bad=1
    } }
  END { if (bad || n == 0) exit 1; print n }' "$TMP/live.csv" "$TMP/drill.csv")"
echo "drill.sh: ${TABLES} tables compared, counts ok"

CURRENT_STEP="file-roundtrip"
# Same rclone config shape as backup.sh (0600, built from env, never printed).
umask 077
export RCLONE_CONFIG="$TMP/rclone.conf"
pw1="$(printf '%s' "$BACKUP_RCLONE_CRYPT_PASSWORD" | rclone obscure -)"
pw2="$(printf '%s' "$BACKUP_RCLONE_CRYPT_SALT" | rclone obscure -)"
{
  printf '[r2]\ntype = s3\nprovider = Cloudflare\nendpoint = %s\nregion = auto\nno_check_bucket = true\naccess_key_id = %s\nsecret_access_key = %s\n\n' \
    "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY"
  printf '[r2crypt]\ntype = crypt\nremote = r2:%s\nfilename_encryption = standard\npassword = %s\npassword2 = %s\n' \
    "$BACKUP_S3_BUCKET" "$pw1" "$pw2"
} >"$RCLONE_CONFIG"
unset pw1 pw2

# One random live file (legacy backups/ dumps are not files). An empty bucket
# has nothing to round-trip, which is not a failure.
file_key="$(live_aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix tenants/ --max-keys 50 \
    --query 'Contents[].[Key]' --output text \
  | { grep -v -e '^None$' -e '^$' || true; } \
  | awk 'BEGIN{srand()} {a[NR]=$0} END{if(NR) print a[int(rand()*NR)+1]}')"
if [[ -n "$file_key" ]]; then
  live_sum="$(live_aws s3 cp "s3://${S3_BUCKET}/${file_key}" - | sha256sum | cut -d' ' -f1)"
  r2_sum="$(rclone cat "r2crypt:files/${file_key}" | sha256sum | cut -d' ' -f1)"
  if [[ "$live_sum" != "$r2_sum" ]]; then
    echo "drill.sh: a live file differs from its encrypted R2 copy" >&2
    exit 1
  fi
  echo "drill.sh: file round-trip ok"
else
  echo "drill.sh: live files bucket is empty, skipping file round-trip"
fi

CURRENT_STEP="done"
echo "drill.sh: done"
