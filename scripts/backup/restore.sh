#!/usr/bin/env bash
# Restore a backup archive into a target database and print integrity counts.
# Migrations are the caller's job (run them from the app image: node server/dist/scripts/migrate.js
# run). This script needs no ts-node, only aws, age, psql and pg_restore (the backup image has them).
#
#   scripts/backup/restore.sh <s3-key-or-local-file> <TARGET_DATABASE_URL | @env> [flags]
#
# Flags:
#   --no-migrate          accepted and ignored (migration was removed; old callers still pass it)
#   --require-empty       the target must hold no data: users = 0 and no school except the
#                         migration-made 'default-school' (a missing table counts as 0). Checked
#                         first (before the download), then again inside the restore transaction.
#                         Not empty: exit 3. The restore is then ONE transaction: check, DROP SCHEMA
#                         public CASCADE, CREATE SCHEMA public, the dump. Any failure rolls back.
#                         Without it, pg_restore --clean --if-exists is used (empty _next DBs).
#   --expect-db <name>    the target URL's database name must equal <name>, else exit 1
#   --allow-live-target   lets the target equal this environment's DATABASE_URL (the prod restore
#                         does exactly that). Only valid with --require-empty and --expect-db, so
#                         the empty check and the name check are always the protection.
#   --single-transaction  accepted and ignored (--require-empty is always one transaction)
# Migrations are NOT run here: run migrate.js from the app image afterwards.
# "@env" as the target means "use $DATABASE_URL", so the password never goes on a command line.
#
# A bare key starting with "db/" (e.g. db/hourly/<ts>.dump.age) is fetched from
# the R2 backup bucket with BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET /
# BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY. Any other bare key or
# an s3:// URL uses the legacy S3_* settings below.
#
# Example:
#   scripts/backup/restore.sh backups/db/20260907T020000Z.dump.age \
#     postgres://postgres:postgres@localhost:5432/biddaloy_restore_test
#
# Required env: BACKUP_AGE_PRIVATE_KEY_FILE (path to the age identity file
# — see README's "Generating an age keypair"). Then, by first argument:
#   db/... key        BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
#                     BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
#   other key, s3://  S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID,
#                     S3_SECRET_ACCESS_KEY
#   local file        nothing else
# Optional env: S3_ALLOW_INSECURE_HTTP (opt into a plaintext http://
# S3_ENDPOINT — only for an approved local/dev endpoint; rejected otherwise).
#
# Secrets discipline: never `set -x` here, never echo DATABASE_URL, the
# target URL, or any key material.
set -euo pipefail

usage() {
  echo "Usage: $0 <s3-key-or-local-file> <TARGET_DATABASE_URL|@env> [--require-empty] [--expect-db <name>] [--allow-live-target] [--single-transaction] [--no-migrate]" >&2
  exit 1
}

REQUIRE_EMPTY=0 ALLOW_LIVE=0 EXPECT_DB=""
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-migrate) ;;
    --require-empty) REQUIRE_EMPTY=1 ;;
    --allow-live-target) ALLOW_LIVE=1 ;;
    --single-transaction) ;;
    --expect-db) [[ $# -ge 2 ]] || usage; EXPECT_DB="$2"; shift ;;
    *) args+=("$1") ;;
  esac
  shift
done
[[ ${#args[@]} -eq 2 ]] || usage
set -- "${args[@]}"

ARCHIVE_SOURCE="$1"
TARGET_DATABASE_URL="$2"
if [[ "$TARGET_DATABASE_URL" == "@env" ]]; then
  : "${DATABASE_URL:?DATABASE_URL is required for target @env}"
  TARGET_DATABASE_URL="$DATABASE_URL"
fi

# Refuse to run if TARGET_DATABASE_URL equals the production DATABASE_URL
# this process's environment carries — a restore is destructive
# (`pg_restore --clean`), so overwriting the live database by a
# copy-paste mistake must fail loudly rather than silently succeed.
#
# This is a string-equality guard, not an identity check: two different
# URLs (a DNS alias, a different host resolving to the same instance) can
# still point at the live database and this check will not catch it. It
# catches the copy-paste mistake it's meant for. The one legitimate live
# restore (a fresh VM, biddaloy-restore-prod) opts out with --allow-live-target and is then
# protected by --require-empty and --expect-db instead.
if [[ -n "${DATABASE_URL:-}" && "$TARGET_DATABASE_URL" == "$DATABASE_URL" ]]; then
  if [[ $ALLOW_LIVE -eq 1 && $REQUIRE_EMPTY -eq 1 && -n "$EXPECT_DB" ]]; then
    :
  else
    echo "restore.sh: refusing to restore — TARGET_DATABASE_URL matches this environment's DATABASE_URL (the live database)." >&2
    exit 1
  fi
fi
if [[ -n "$EXPECT_DB" ]]; then
  target_db="${TARGET_DATABASE_URL%%\?*}"
  target_db="${target_db##*/}"
  if [[ "$target_db" != "$EXPECT_DB" ]]; then
    echo "restore.sh: refusing to restore — the target database name is not the expected one." >&2
    exit 1
  fi
fi

# A missing table counts as 0. query_to_xml keeps a missing table from failing at parse time.
# Counts only; no row content is read.
count_sql() {
  cat <<'SQL'
SELECT CASE WHEN to_regclass('public.users') IS NULL THEN 0
         ELSE (xpath('/row/c/text()', query_to_xml('select count(*) c from public.users', false, true, '')))[1]::text::int END
     + CASE WHEN to_regclass('public.schools') IS NULL THEN 0
         ELSE (xpath('/row/c/text()', query_to_xml('select count(*) c from public.schools where slug <> ''default-school''', false, true, '')))[1]::text::int END
SQL
}
if [[ $REQUIRE_EMPTY -eq 1 ]]; then
  counts="$(psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAq -c "$(count_sql)")" || exit 1
  if [[ "$counts" != "0" ]]; then
    echo "restore.sh: refusing: target already has data (${counts} users + non-default schools)" >&2
    exit 3
  fi
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
elif [[ "$ARCHIVE_SOURCE" == db/* ]]; then
  # R2 backup bucket (what backup.sh writes in R2 mode).
  : "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required to fetch a db/ key}"
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required to fetch a db/ key}"
  : "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is required to fetch a db/ key}"
  : "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is required to fetch a db/ key}"
  if [[ "$BACKUP_S3_ENDPOINT" != https://* ]]; then
    echo "restore.sh: BACKUP_S3_ENDPOINT must be https://" >&2
    exit 1
  fi
  export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="auto"
  echo "restore.sh: downloading s3://${BACKUP_S3_BUCKET}/${ARCHIVE_SOURCE}"
  aws s3 cp --endpoint-url "$BACKUP_S3_ENDPOINT" "s3://${BACKUP_S3_BUCKET}/${ARCHIVE_SOURCE}" "$ENCRYPTED_PATH"
else
  : "${S3_ENDPOINT:?S3_ENDPOINT is required to fetch an S3 archive}"
  : "${S3_REGION:?S3_REGION is required to fetch an S3 archive}"
  : "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required to fetch an S3 archive}"
  : "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required to fetch an S3 archive}"

  # See the matching check in backup.sh: reject a plaintext http://
  # S3_ENDPOINT unless the operator explicitly opts in, since AWS
  # credentials go out with the request.
  if [[ "$S3_ENDPOINT" == http://* && "${S3_ALLOW_INSECURE_HTTP:-}" != "true" ]]; then
    echo "restore.sh: S3_ENDPOINT uses http:// — set S3_ALLOW_INSECURE_HTTP=true only for an approved local/dev endpoint, or use https://" >&2
    exit 1
  fi

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
if [[ $REQUIRE_EMPTY -eq 1 ]]; then
  # One transaction: re-check emptiness, wipe the schema, load the dump. A dump older than the
  # deployed code cannot clash with newer tables, because nothing from the migrated schema is kept.
  # CREATE EXTENSION (btree_gist) comes back from the dump. pg_restore writes the SQL to a file
  # first, so a pg_restore failure can never reach psql as a half-finished script.
  pg_restore --no-owner -f "$WORKDIR/restore.sql" "$DUMP_PATH"
  {
    cat <<'SQL'
DO $guard$
DECLARE n bigint := 0; m bigint := 0;
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN EXECUTE 'select count(*) from public.users' INTO n; END IF;
  IF to_regclass('public.schools') IS NOT NULL THEN EXECUTE 'select count(*) from public.schools where slug <> ''default-school''' INTO m; END IF;
  IF n + m > 0 THEN RAISE EXCEPTION 'restore-refused-not-empty'; END IF;
END
$guard$;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SQL
    cat "$WORKDIR/restore.sql"
  } | psql -1 -q -v ON_ERROR_STOP=1 -o /dev/null "$TARGET_DATABASE_URL" 2>"$WORKDIR/psql.err" || {
    if grep -q 'restore-refused-not-empty' "$WORKDIR/psql.err"; then
      echo "restore.sh: refusing: target already has data (found inside the restore transaction)" >&2
      exit 3
    fi
    echo "restore.sh: restore FAILED and was rolled back (the target is unchanged)" >&2
    exit 1
  }
else
  pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" "$DUMP_PATH"
fi

echo "restore.sh: verifying integrity"
psql "$TARGET_DATABASE_URL" -f "$(dirname "$0")/verify.sql"

echo "restore.sh: done (migrations NOT run; run migrate.js from the app image)"
