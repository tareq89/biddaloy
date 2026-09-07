#!/usr/bin/env bash
# Daily encrypted PostgreSQL backup to the S3-compatible bucket.
#
# Pipeline: pg_dump -> age (encrypt) -> aws s3 cp (upload). Plaintext dump
# bytes only ever exist in the pipe between these three processes — never
# written to disk — so a compromised host filesystem never yields a
# readable dump.
#
# Required env: DATABASE_URL, BACKUP_AGE_PUBLIC_KEY, S3_BUCKET, S3_ENDPOINT,
# S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
# Optional env: BACKUP_RETENTION_DAYS (default 30), SENTRY_CRON_MONITOR_URL.
#
# Secrets discipline: never `set -x` here, never echo DATABASE_URL or any
# key material. If you add debug output, echo shape/status only ("upload
# ok", "12 objects found") — never a variable that could hold a credential.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$S3_REGION"

S3_ENDPOINT_ARGS=(--endpoint-url "$S3_ENDPOINT")

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
object_key="backups/db/${timestamp}.dump.age"

cron_checkin() {
  # $1: in_progress | ok | error. No-op when the monitor isn't configured
  # (e.g. local dev) — a missing SENTRY_CRON_MONITOR_URL is not a failure.
  local status="$1"
  if [[ -n "${SENTRY_CRON_MONITOR_URL:-}" ]]; then
    curl -fsS -X POST "${SENTRY_CRON_MONITOR_URL}?status=${status}" >/dev/null || true
  fi
}

on_exit() {
  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    cron_checkin ok
  else
    echo "backup.sh: failed with exit code ${exit_code}" >&2
    cron_checkin error
  fi
  exit "$exit_code"
}
trap on_exit EXIT

cron_checkin in_progress

echo "backup.sh: dumping database and uploading to s3://${S3_BUCKET}/${object_key}"

pg_dump -Fc "$DATABASE_URL" \
  | age -r "$BACKUP_AGE_PUBLIC_KEY" \
  | aws s3 cp "${S3_ENDPOINT_ARGS[@]}" - "s3://${S3_BUCKET}/${object_key}"

echo "backup.sh: upload complete"

# Retention: delete objects older than BACKUP_RETENTION_DAYS. This is a
# fallback — prefer a bucket lifecycle rule where the provider supports
# one — but MinIO/dev and some S3-compatible providers don't, so the
# script enforces it itself rather than assuming one exists.
#
# Uses plain arithmetic on epoch seconds rather than `date -d "-N days"`
# (GNU) or `date -v -Nd` (BSD) — this script runs in the Alpine image
# (scripts/backup/Dockerfile), whose busybox `date` supports neither.
# `-D FMT -d STR` below is busybox's own parse-a-custom-format syntax.
now_epoch="$(date -u +%s)"
cutoff_epoch=$((now_epoch - BACKUP_RETENTION_DAYS * 86400))

echo "backup.sh: pruning backups older than ${BACKUP_RETENTION_DAYS} days"

aws s3api list-objects-v2 "${S3_ENDPOINT_ARGS[@]}" \
  --bucket "$S3_BUCKET" \
  --prefix "backups/db/" \
  --query 'Contents[].[Key,LastModified]' \
  --output text \
| while IFS=$'\t' read -r key last_modified; do
    # An empty/no-match query prints the literal "None" via --output text
    # rather than empty output — guard against that as well as a truly
    # blank line, or this would try to `aws s3 rm s3://.../None`.
    [[ -z "$key" || "$key" == "None" ]] && continue
    last_modified_prefix="${last_modified:0:19}" # "2026-08-01T02:00:00" — drop offset/fraction
    object_epoch="$(date -u -D '%Y-%m-%dT%H:%M:%S' -d "$last_modified_prefix" +%s)"
    if [[ "$object_epoch" -lt "$cutoff_epoch" ]]; then
      echo "backup.sh: deleting expired backup ${key}"
      aws s3 rm "${S3_ENDPOINT_ARGS[@]}" "s3://${S3_BUCKET}/${key}"
    fi
  done

echo "backup.sh: done"
