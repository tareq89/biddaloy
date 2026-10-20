#!/usr/bin/env bash
# Hourly encrypted PostgreSQL + files backup to Cloudflare R2 (S3-compatible).
#
# R2 mode (BACKUP_S3_* set): dump -> daily copy (from 02:00 Asia/Dhaka) -> db
# count prunes -> rclone crypt sync of the files bucket -> trash date purge ->
# Uptime Kuma push.
# Legacy mode (BACKUP_S3_* unset: local dev, restore drill): old backups/db/
# key + LastModified prune with BACKUP_RETENTION_DAYS; no daily copy, no files.
#
# Pipeline: pg_dump -> age (encrypt) -> aws s3 cp (upload). Plaintext dump
# bytes only ever exist in the pipe between these three processes — never
# written to disk — so a compromised host filesystem never yields a
# readable dump.
#
# Required env: DATABASE_URL, BACKUP_AGE_PUBLIC_KEY, S3_BUCKET, S3_ENDPOINT,
# S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (also the files source).
# R2 env (all or none): BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
# BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY,
# BACKUP_RCLONE_CRYPT_PASSWORD, BACKUP_RCLONE_CRYPT_SALT.
# Optional env: BACKUP_RETENTION_DAYS (legacy, default 30), BACKUP_HOURLY_KEEP
# (72), BACKUP_DAILY_KEEP (30), BACKUP_TRASH_DAYS (30), BACKUP_FILES_MAX_DELETE
# (500, files sync fails above this many deletes), BACKUP_PUSH_URL (Kuma),
# BACKUP_NET_WAIT_SECS (900), BACKUP_NOW + BACKUP_TEST_CLOCK_OK=1 (tests only),
# SENTRY_CRON_MONITOR_URL, S3_ALLOW_INSECURE_HTTP (opt into a plaintext
# http:// S3_ENDPOINT — only for an approved local/dev endpoint).
#
# Secrets discipline: never `set -x` here, never echo DATABASE_URL, push URL
# or any key material. If you add debug output, echo shape/status only
# ("upload ok", "12 objects found") — never a variable that could hold a
# credential.
set -euo pipefail

# Trap first, so even a config error pushes `down&msg=config`.
CURRENT_STEP="config"
RCLONE_TMP=""

cron_checkin() {
  # $1: in_progress | ok | error. No-op when the monitor isn't configured
  # (e.g. local dev) — a missing SENTRY_CRON_MONITOR_URL is not a failure.
  local status="$1"
  if [[ -n "${SENTRY_CRON_MONITOR_URL:-}" ]]; then
    curl -fsS --connect-timeout 5 --max-time 10 -X POST "${SENTRY_CRON_MONITOR_URL}?status=${status}" >/dev/null || true
  fi
}

kuma_push() {
  # $1: up | down, $2: a step name (never a secret). BACKUP_PUSH_URL is the
  # bare push URL (token in the path); any query on it is dropped. It is never
  # echoed and curl's stderr is discarded. No-op when unset.
  if [[ -n "${BACKUP_PUSH_URL:-}" ]]; then
    local base="${BACKUP_PUSH_URL%%\?*}"
    curl -fsS --connect-timeout 5 --max-time 10 "${base}?status=${1}&msg=${2}" >/dev/null 2>&1 || true
  fi
}

on_exit() {
  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    kuma_push up ok
    cron_checkin ok
  else
    echo "backup.sh: failed at step '${CURRENT_STEP}' with exit code ${exit_code}" >&2
    # A failed dump may leave a truncated object; remove it (best effort).
    if [[ "$CURRENT_STEP" == "dump" && -n "${object_key:-}" ]]; then
      aws s3 rm --endpoint-url "${DEST_ENDPOINT:-}" "s3://${DEST_BUCKET:-}/${object_key}" >/dev/null 2>&1 || true
    fi
    kuma_push down "$CURRENT_STEP"
    cron_checkin error
  fi
  if [[ -n "$RCLONE_TMP" ]]; then rm -rf "$RCLONE_TMP"; fi
  exit "$exit_code"
}
trap on_exit EXIT

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
if ! [[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "backup.sh: BACKUP_RETENTION_DAYS must be a positive integer, got '${BACKUP_RETENTION_DAYS}'" >&2
  exit 1
fi

# S3_ENDPOINT must be HTTPS unless the operator explicitly opts into
# cleartext (S3_ALLOW_INSECURE_HTTP=true) — set by docker-compose.yml for
# the bundled SeaweedFS service, which shares a Docker network with no TLS
# termination today (see "Known gap" in docs/architecture/08-security.md).
if [[ "$S3_ENDPOINT" == http://* && "${S3_ALLOW_INSECURE_HTTP:-}" != "true" ]]; then
  echo "backup.sh: S3_ENDPOINT uses http:// — set S3_ALLOW_INSECURE_HTTP=true only for an approved local/dev endpoint, or use https://" >&2
  exit 1
fi

# --- mode ---------------------------------------------------------------
r2_vars=(BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_RCLONE_CRYPT_PASSWORD BACKUP_RCLONE_CRYPT_SALT)
r2_set=0
for v in "${r2_vars[@]}"; do
  if [[ -n "${!v:-}" ]]; then r2_set=$((r2_set + 1)); fi
done
if [[ $r2_set -ne 0 && $r2_set -ne ${#r2_vars[@]} ]]; then
  echo "backup.sh: BACKUP_S3_* and BACKUP_RCLONE_CRYPT_* must be set together (all or none)" >&2
  exit 1
fi
if [[ $r2_set -eq 0 ]]; then R2_MODE=0; else R2_MODE=1; fi

BACKUP_HOURLY_KEEP="${BACKUP_HOURLY_KEEP:-72}"
BACKUP_DAILY_KEEP="${BACKUP_DAILY_KEEP:-30}"
BACKUP_TRASH_DAYS="${BACKUP_TRASH_DAYS:-30}"
BACKUP_FILES_MAX_DELETE="${BACKUP_FILES_MAX_DELETE:-500}"
BACKUP_NET_WAIT_SECS="${BACKUP_NET_WAIT_SECS:-900}"
for v in BACKUP_HOURLY_KEEP BACKUP_DAILY_KEEP BACKUP_TRASH_DAYS BACKUP_FILES_MAX_DELETE; do
  if ! [[ "${!v}" =~ ^[1-9][0-9]*$ ]]; then
    echo "backup.sh: ${v} must be a positive integer" >&2
    exit 1
  fi
done
if ! [[ "$BACKUP_NET_WAIT_SECS" =~ ^[0-9]+$ ]]; then
  echo "backup.sh: BACKUP_NET_WAIT_SECS must be a non-negative integer" >&2
  exit 1
fi

if [[ $R2_MODE -eq 1 ]]; then
  if [[ "$BACKUP_S3_ENDPOINT" != https://* ]]; then
    echo "backup.sh: BACKUP_S3_ENDPOINT must be https://" >&2
    exit 1
  fi
  # Same check as entrypoint.sh: a copied .env.example placeholder would
  # encrypt every file with a public password. The value is never printed.
  for v in BACKUP_S3_SECRET_ACCESS_KEY BACKUP_RCLONE_CRYPT_PASSWORD BACKUP_RCLONE_CRYPT_SALT; do
    val="${!v}"
    if [[ "$val" == *change-me* || ${#val} -lt 16 ]]; then
      echo "backup.sh: ${v} is a placeholder or shorter than 16 characters" >&2
      exit 1
    fi
  done
  unset val
  export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="auto"
  # aws-cli >= 2.23 sends CRC checksum trailers by default; R2 has rejected
  # some of those shapes, which would fail every run at `dump`.
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  DEST_ENDPOINT="$BACKUP_S3_ENDPOINT"
  DEST_BUCKET="$BACKUP_S3_BUCKET"
else
  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$S3_REGION"
  DEST_ENDPOINT="$S3_ENDPOINT"
  DEST_BUCKET="$S3_BUCKET"
fi
S3_ENDPOINT_ARGS=(--endpoint-url "$DEST_ENDPOINT")

# --- clock --------------------------------------------------------------
# All time math is epoch arithmetic. Asia/Dhaka is a fixed UTC+6 (no DST), so
# the Dhaka hour/date is epoch+21600 formatted as UTC — independent of TZ.
# Works with GNU date (CI), busybox date (image) and BSD date (dev laptops).
fmt_epoch() { date -u -d "@$1" "+$2" 2>/dev/null || date -u -r "$1" "+$2"; }
# BACKUP_NOW fakes the clock for tests only; without BACKUP_TEST_CLOCK_OK=1
# a stray value is ignored, so it can never freeze the production clock.
if [[ -n "${BACKUP_NOW:-}" && "${BACKUP_TEST_CLOCK_OK:-}" == "1" ]]; then
  if ! [[ "$BACKUP_NOW" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    echo "backup.sh: BACKUP_NOW must look like 2026-10-20T20:00:00Z" >&2
    exit 1
  fi
  now_str="${BACKUP_NOW:0:19}"
  now_str="${now_str/T/ }"
  now_epoch="$(date -u -d "$now_str" +%s 2>/dev/null || date -u -j -f '%Y-%m-%d %H:%M:%S' "$now_str" +%s)"
else
  now_epoch="$(date -u +%s)"
fi
dhaka_epoch=$((now_epoch + 21600))
timestamp="$(fmt_epoch "$now_epoch" %Y%m%dT%H%M%SZ)"
dhaka_hour="$(fmt_epoch "$dhaka_epoch" %H)"
dhaka_date="$(fmt_epoch "$dhaka_epoch" %Y-%m-%d)"

if [[ $R2_MODE -eq 1 ]]; then
  object_key="db/hourly/${timestamp}.dump.age"
else
  object_key="backups/db/${timestamp}.dump.age"
fi

cron_checkin in_progress

# Network outage: probe and wait (any HTTP answer counts as "up"), then go on
# regardless — a real failure then surfaces from the failing step itself.
wait_for_network() {
  local waited=0
  while ! curl -sS -o /dev/null --connect-timeout 5 --max-time 10 "$DEST_ENDPOINT" 2>/dev/null; do
    if [[ $waited -ge $BACKUP_NET_WAIT_SECS ]]; then
      echo "backup.sh: network still down after ${waited}s, trying anyway" >&2
      return 0
    fi
    echo "backup.sh: destination unreachable, waiting"
    sleep 30
    waited=$((waited + 30))
  done
}
if [[ $R2_MODE -eq 1 ]]; then wait_for_network; fi

# list_keys PREFIX -> one key per line, sorted (UTC timestamps in keys sort by time)
list_keys() {
  aws s3api list-objects-v2 "${S3_ENDPOINT_ARGS[@]}" \
    --bucket "$DEST_BUCKET" --prefix "$1" \
    --query 'Contents[].[Key]' --output text \
  | { grep -v -e '^None$' -e '^$' || true; } | sort
}

# prune_keep PREFIX KEEP -> delete all but the newest KEEP keys under PREFIX
prune_keep() {
  local key
  list_keys "$1" | awk -v n="$2" '{a[NR]=$0} END{for(i=1;i<=NR-n;i++)print a[i]}' \
  | while IFS= read -r key; do
      echo "backup.sh: deleting expired backup ${key}"
      aws s3 rm "${S3_ENDPOINT_ARGS[@]}" "s3://${DEST_BUCKET}/${key}"
    done
}

CURRENT_STEP="dump"
echo "backup.sh: dumping database and uploading to s3://${DEST_BUCKET}/${object_key}"

pg_dump -Fc "$DATABASE_URL" \
  | age -r "$BACKUP_AGE_PUBLIC_KEY" \
  | aws s3 cp "${S3_ENDPOINT_ARGS[@]}" - "s3://${DEST_BUCKET}/${object_key}"

CURRENT_STEP="uploaded"
echo "backup.sh: upload complete"

if [[ $R2_MODE -eq 1 ]]; then
  # Daily copy with catch-up: from 02:00 Dhaka on, copy as soon as today's
  # daily is missing (a missed 02:00 run is repaired by the next hourly one).
  if [[ "$((10#$dhaka_hour))" -ge 2 ]]; then
    CURRENT_STEP="daily-copy"
    daily_key="db/daily/${dhaka_date}.dump.age"
    if [[ -z "$(list_keys "$daily_key")" ]]; then
      aws s3 cp "${S3_ENDPOINT_ARGS[@]}" "s3://${DEST_BUCKET}/${object_key}" "s3://${DEST_BUCKET}/${daily_key}"
      echo "backup.sh: daily copy complete"
    fi
  fi

  # DB prunes run before the files sync so a files failure never skips them.
  CURRENT_STEP="prune-hourly"
  prune_keep "db/hourly/" "$BACKUP_HOURLY_KEEP"
  CURRENT_STEP="prune-daily"
  prune_keep "db/daily/" "$BACKUP_DAILY_KEEP"

  CURRENT_STEP="files-sync"
  # Config lives in a 0700 temp dir, file 0600, built from env; never printed.
  umask 077
  RCLONE_TMP="$(mktemp -d)"
  export RCLONE_CONFIG="$RCLONE_TMP/rclone.conf"
  pw1="$(printf '%s' "$BACKUP_RCLONE_CRYPT_PASSWORD" | rclone obscure -)"
  pw2="$(printf '%s' "$BACKUP_RCLONE_CRYPT_SALT" | rclone obscure -)"
  {
    printf '[src]\ntype = s3\nprovider = Other\nendpoint = %s\nregion = %s\naccess_key_id = %s\nsecret_access_key = %s\nforce_path_style = true\n\n' \
      "$S3_ENDPOINT" "$S3_REGION" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
    printf '[r2]\ntype = s3\nprovider = Cloudflare\nendpoint = %s\nregion = auto\nno_check_bucket = true\naccess_key_id = %s\nsecret_access_key = %s\n\n' \
      "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY"
    # Crypt root is the bucket, so files/ and files-trash/ share one remote
    # (rclone requires --backup-dir on the same remote as the destination).
    printf '[r2crypt]\ntype = crypt\nremote = r2:%s\nfilename_encryption = standard\npassword = %s\npassword2 = %s\n' \
      "$BACKUP_S3_BUCKET" "$pw1" "$pw2"
  } > "$RCLONE_CONFIG"
  chmod 600 "$RCLONE_CONFIG"
  unset pw1 pw2

  # Guard: an empty source against a non-empty copy means the source is
  # broken (wrong bucket, outage), not that every file was deleted. Don't sync.
  # backups/ in the source bucket holds legacy dumps; they are not files.
  src_top="$(rclone lsf "src:${S3_BUCKET}" --max-depth 1 --exclude '/backups/**' | { grep -v '^backups/$' || true; })"
  rc=0
  dst_top="$(rclone lsf r2crypt:files --max-depth 1)" || rc=$?
  if [[ $rc -ne 0 && $rc -ne 3 ]]; then exit "$rc"; fi
  if [[ -z "$src_top" && -n "$dst_top" ]]; then
    echo "backup.sh: source bucket looks empty but the backup is not; refusing to sync" >&2
    exit 1
  fi

  # Deleted/overwritten files move to files-trash/<date>/ instead of vanishing.
  # --suffix adds the Dhaka run time (a.txt-140000), so a file changed twice on
  # one date keeps both old copies.
  sync_args=("src:${S3_BUCKET}" r2crypt:files --exclude '/backups/**'
    --backup-dir "r2crypt:files-trash/${dhaka_date}"
    --suffix "-$(fmt_epoch "$dhaka_epoch" %H%M%S)"
    --max-delete "$BACKUP_FILES_MAX_DELETE"
    --fast-list --transfers 8)
  # rclone checks --max-delete as it goes: a real sync moves the first N files
  # to the trash and only then fails, so a broken but non-empty source would
  # drain files/ N per hour until a run succeeds and the alert clears. A dry
  # run with the same flags fails the same way but touches nothing; only when
  # it passes does the real sync run.
  if ! rclone sync "${sync_args[@]}" --dry-run -q; then
    echo "backup.sh: files sync would delete more than BACKUP_FILES_MAX_DELETE files (or the dry run failed); refusing to sync" >&2
    exit 1
  fi
  rclone sync "${sync_args[@]}"
  echo "backup.sh: files sync complete"

  # Trash is pruned by the date in the folder name, not file age: moved files
  # keep their original modtime, so `--min-age` would wipe them at once.
  CURRENT_STEP="prune-trash"
  cutoff_date="$(fmt_epoch $((dhaka_epoch - BACKUP_TRASH_DAYS * 86400)) %Y-%m-%d)"
  # rclone lsf exits 3 when the folder does not exist yet: that means empty.
  { rclone lsf --dirs-only r2crypt:files-trash || [[ $? -eq 3 ]]; } \
  | while IFS= read -r d; do
      d="${d%/}"
      [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
      if [[ "$d" < "$cutoff_date" ]]; then
        echo "backup.sh: purging expired trash ${d}"
        rclone purge "r2crypt:files-trash/${d}"
      fi
    done
else
  # Legacy retention (dev / restore drill): delete objects older than
  # BACKUP_RETENTION_DAYS by LastModified. Plain epoch arithmetic; the
  # timestamp is parsed as "YYYY-MM-DD hh:mm:ss", which GNU and busybox
  # date both accept.
  CURRENT_STEP="prune"
  cutoff_epoch=$((now_epoch - BACKUP_RETENTION_DAYS * 86400))
  echo "backup.sh: pruning backups older than ${BACKUP_RETENTION_DAYS} days"

  aws s3api list-objects-v2 "${S3_ENDPOINT_ARGS[@]}" \
    --bucket "$S3_BUCKET" \
    --prefix "backups/db/" \
    --query 'Contents[].[Key,LastModified]' \
    --output text \
  | while IFS=$'\t' read -r key last_modified; do
      # No-match prints the literal "None" with --output text.
      [[ -z "$key" || "$key" == "None" ]] && continue
      last_modified_prefix="${last_modified:0:19}" # drop offset/fraction
      object_epoch="$(date -u -d "${last_modified_prefix/T/ }" +%s)"
      if [[ "$object_epoch" -lt "$cutoff_epoch" ]]; then
        echo "backup.sh: deleting expired backup ${key}"
        aws s3 rm "${S3_ENDPOINT_ARGS[@]}" "s3://${S3_BUCKET}/${key}"
      fi
    done
fi

CURRENT_STEP="done"
echo "backup.sh: done"
