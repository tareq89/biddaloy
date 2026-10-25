#!/usr/bin/env bash
# Ships one day of host-exported logs to R2, encrypted (Epic 79, decisions D7, D24). Runs in the
# `jobs` container of the prod stack, started by `biddaloy-nightly log-archive`, which first writes
# /export/<date>/*.log.gz on the host (one file per container, plus host.log.gz).
#
#   1. rclone copy /export/<date> -> r2crypt:logs/<date>/   (file names and contents encrypted)
#   2. rclone check the copy
#   3. delete r2crypt:logs/<date>/ folders older than LOG_ARCHIVE_KEEP_DAYS (180) by their name
#   4. delete /export/<date> -- only after the check passed
#
# Logs are redacted at the source (Rule 13); this script never opens a log file, it only hands
# paths to rclone.
# Exit codes: 0 ok, 1 failed (the local export is kept), 2 refused.
#
# Required env: LOG_ARCHIVE_DATE (YYYY-MM-DD, the day exported)
# R2 settings, each LOG_ARCHIVE_<X> falling back to BACKUP_<X>: S3_ENDPOINT (https), S3_BUCKET,
#   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, RCLONE_CRYPT_PASSWORD, RCLONE_CRYPT_SALT.
# Optional: LOG_ARCHIVE_EXPORT_DIR (/export), LOG_ARCHIVE_KEEP_DAYS (180).
# Never `set -x`; never echo a key.
set -euo pipefail

say() { printf 'log-archive.sh: %s\n' "$*" >&2; }
need() {
  local name="$1" v="LOG_ARCHIVE_$1" b="BACKUP_$1"
  printf -v "$name" '%s' "${!v:-${!b:-}}"
  [[ -n "${!name}" ]] || { say "LOG_ARCHIVE_${name} (or BACKUP_${name}) is required"; exit 2; }
}

DATE="${LOG_ARCHIVE_DATE:-}"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { say "LOG_ARCHIVE_DATE must be YYYY-MM-DD"; exit 2; }
EXPORT="${LOG_ARCHIVE_EXPORT_DIR:-/export}"
KEEP="${LOG_ARCHIVE_KEEP_DAYS:-180}"
[[ "$KEEP" =~ ^[0-9]+$ ]] || { say "LOG_ARCHIVE_KEEP_DAYS must be a number"; exit 2; }
[[ -d "$EXPORT/$DATE" ]] || { say "nothing exported for $DATE"; exit 1; }
for n in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY RCLONE_CRYPT_PASSWORD RCLONE_CRYPT_SALT; do need "$n"; done
[[ "$S3_ENDPOINT" == https://* ]] || { say "endpoint must be https://"; exit 2; }

# days_ago N -> YYYY-MM-DD (GNU/busybox date, then BSD date for local runs).
days_ago() {
  local t=$(($(date +%s) - $1 * 86400))
  date -d "@$t" +%F 2>/dev/null || date -r "$t" +%F
}

# Config lives in a 0700 temp dir, file 0600, built from env; never printed.
umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export RCLONE_CONFIG="$TMP/rclone.conf"
pw1="$(printf '%s' "$RCLONE_CRYPT_PASSWORD" | rclone obscure -)"
pw2="$(printf '%s' "$RCLONE_CRYPT_SALT" | rclone obscure -)"
{
  printf '[r2]\ntype = s3\nprovider = Cloudflare\nendpoint = %s\nregion = auto\nno_check_bucket = true\naccess_key_id = %s\nsecret_access_key = %s\n\n' \
    "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
  printf '[r2crypt]\ntype = crypt\nremote = r2:%s\nfilename_encryption = standard\npassword = %s\npassword2 = %s\n' \
    "$S3_BUCKET" "$pw1" "$pw2"
} > "$RCLONE_CONFIG"
unset pw1 pw2

echo "step 1/4: copy"
rclone copy "$EXPORT/$DATE" "r2crypt:logs/$DATE/" || { say "copy failed; local export kept"; exit 1; }
echo "step 2/4: check"
rclone check "$EXPORT/$DATE" "r2crypt:logs/$DATE/" || { say "check failed; local export kept"; exit 1; }

echo "step 3/4: retention (${KEEP} days)"
cutoff="$(days_ago "$KEEP")"
dirs="$(rclone lsf --dirs-only r2crypt:logs)" || { say "could not list logs/; local export kept"; exit 1; }
while IFS= read -r d; do
  d="${d%/}"
  [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  # Same-width dates compare correctly as strings.
  if [[ "$d" < "$cutoff" ]]; then
    rclone purge "r2crypt:logs/$d" || { say "could not delete logs/$d; local export kept"; exit 1; }
    echo "deleted logs/$d"
  fi
done <<<"$dirs"

echo "step 4/4: remove local export"
rm -rf "${EXPORT:?}/$DATE"
echo "log-archive ok: $DATE"
