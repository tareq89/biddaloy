#!/usr/bin/env bash
# One command to restore a backup archive into a target database, run
# migrations, and print integrity counts.
#
#   scripts/backup/restore.sh <s3-key-or-local-file> <TARGET_DATABASE_URL>
#
# Example:
#   scripts/backup/restore.sh backups/db/20260907T020000Z.dump.age \
#     postgres://postgres:postgres@localhost:5432/biddaloy_restore_test
#
# Required env: BACKUP_AGE_PRIVATE_KEY_FILE (path to the age identity file
# — see README's "Generating an age keypair"), S3_BUCKET, S3_ENDPOINT,
# S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (only needed when the
# first argument is an s3 key rather than a local file).
#
# Secrets discipline: never `set -x` here, never echo DATABASE_URL, the
# target URL, or any key material.
set -euo pipefail

usage() {
  echo "Usage: $0 <s3-key-or-local-file> <TARGET_DATABASE_URL>" >&2
  exit 1
}

[[ $# -eq 2 ]] || usage

ARCHIVE_SOURCE="$1"
TARGET_DATABASE_URL="$2"

# Refuse to run if TARGET_DATABASE_URL equals the production DATABASE_URL
# this process's environment carries — a restore is destructive
# (`pg_restore --clean`), so overwriting the live database by a
# copy-paste mistake must fail loudly rather than silently succeed.
if [[ -n "${DATABASE_URL:-}" && "$TARGET_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "restore.sh: refusing to restore — TARGET_DATABASE_URL matches this environment's DATABASE_URL (the live database)." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

DUMP_PATH="$WORKDIR/restore.dump"
ENCRYPTED_PATH="$WORKDIR/restore.dump.age"

# A local file (existing path, "./..." or "/...") is used as-is; anything
# else — including a bare "backups/db/<ts>.dump.age" key or a full
# "s3://bucket/key" URL — is treated as an object to fetch from the bucket.
if [[ -f "$ARCHIVE_SOURCE" ]]; then
  echo "restore.sh: using local archive ${ARCHIVE_SOURCE}"
  cp "$ARCHIVE_SOURCE" "$ENCRYPTED_PATH"
else
  : "${S3_ENDPOINT:?S3_ENDPOINT is required to fetch an S3 archive}"
  : "${S3_REGION:?S3_REGION is required to fetch an S3 archive}"
  : "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required to fetch an S3 archive}"
  : "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required to fetch an S3 archive}"

  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$S3_REGION"

  if [[ "$ARCHIVE_SOURCE" == s3://* ]]; then
    # A full "s3://<bucket>/<key>" URL names its own bucket — honor that
    # bucket rather than silently substituting $S3_BUCKET, which could
    # differ and would then fetch from the wrong place.
    s3_url="$ARCHIVE_SOURCE"
  else
    # A bare key (e.g. "backups/db/<ts>.dump.age") is relative to
    # $S3_BUCKET, which is only required in this branch.
    : "${S3_BUCKET:?S3_BUCKET is required when ARCHIVE_SOURCE is a bare key, not a full s3:// URL}"
    s3_url="s3://${S3_BUCKET}/${ARCHIVE_SOURCE}"
  fi

  echo "restore.sh: downloading ${s3_url}"
  aws s3 cp --endpoint-url "$S3_ENDPOINT" "$s3_url" "$ENCRYPTED_PATH"
fi

: "${BACKUP_AGE_PRIVATE_KEY_FILE:?BACKUP_AGE_PRIVATE_KEY_FILE is required}"

echo "restore.sh: decrypting"
age --decrypt -i "$BACKUP_AGE_PRIVATE_KEY_FILE" -o "$DUMP_PATH" "$ENCRYPTED_PATH"

echo "restore.sh: restoring into target database"
pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" "$DUMP_PATH"

echo "restore.sh: running server migrations against the target"
(
  cd "$(dirname "$0")/../../server"
  DATABASE_URL="$TARGET_DATABASE_URL" yarn migration:run
)

echo "restore.sh: verifying integrity"
psql "$TARGET_DATABASE_URL" -f "$(dirname "$0")/verify.sql"

echo "restore.sh: done"
