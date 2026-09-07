#!/usr/bin/env bash
# Integration test for backup.sh: runs the real script against a local
# minio + db from docker-compose (started by this script if not already
# up), then asserts:
#   1. exactly one new object lands under backups/db/ with a .dump.age suffix
#   2. that object decrypts with the matching age private key
#   3. the decrypted bytes are a valid pg_dump custom-format archive
#      (pg_restore --list succeeds on it)
#
# Requires docker, docker compose, age, and either a local aws-cli or the
# `amazon/aws-cli` image (used via docker run below to avoid a host
# dependency). Not run by `yarn test` — it needs live docker compose
# services, so it's invoked separately, e.g. in CI or by hand:
#
#   scripts/backup/backup.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "backup.test.sh: bringing up db + minio"
docker compose up -d db minio minio-init
docker compose exec -T db sh -c 'until pg_isready -U "$POSTGRES_USER"; do sleep 1; done' >/dev/null

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "backup.test.sh: generating a throwaway age keypair"
age-keygen -o "$WORKDIR/key.txt" 2>"$WORKDIR/keygen.log"
AGE_PUBLIC_KEY="$(grep 'Public key:' "$WORKDIR/keygen.log" | sed 's/.*: //')"
AGE_PRIVATE_KEY="$(grep -v '^#' "$WORKDIR/key.txt")"

: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_PASSWORD:=change-me}"
: "${POSTGRES_DB:=biddaloy}"
: "${S3_ACCESS_KEY_ID:=minioadmin}"
: "${S3_SECRET_ACCESS_KEY:=minioadmin}"
: "${S3_BUCKET:=biddaloy}"

echo "backup.test.sh: running backup.sh"
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
BACKUP_AGE_PUBLIC_KEY="$AGE_PUBLIC_KEY" \
S3_ENDPOINT="http://127.0.0.1:9000" \
S3_ALLOW_INSECURE_HTTP="true" \
S3_REGION="us-east-1" \
S3_BUCKET="$S3_BUCKET" \
S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
BACKUP_RETENTION_DAYS=30 \
  bash "$(dirname "$0")/backup.sh"

echo "backup.test.sh: listing bucket for the uploaded object"
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=us-east-1

# Use the host `aws` CLI when present, otherwise fall back to the
# `amazon/aws-cli` image via `docker run` — this is the fallback the
# header comment above documents, so a host without `aws` installed
# doesn't just fail under `set -e` on the first S3 call.
aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    aws "$@"
  else
    docker run --rm --network host \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
      -v "$WORKDIR:$WORKDIR" \
      amazon/aws-cli "$@"
  fi
}

latest_key="$(aws_cli s3api list-objects-v2 \
  --endpoint-url http://127.0.0.1:9000 \
  --bucket "$S3_BUCKET" \
  --prefix "backups/db/" \
  --query 'sort_by(Contents, &LastModified)[-1].Key' \
  --output text)"

if [[ "$latest_key" != *.dump.age ]]; then
  echo "FAIL: expected a backups/db/*.dump.age object, got '$latest_key'" >&2
  exit 1
fi
echo "PASS: found $latest_key"

aws_cli s3 cp --endpoint-url http://127.0.0.1:9000 "s3://${S3_BUCKET}/${latest_key}" "$WORKDIR/backup.dump.age"

echo "backup.test.sh: decrypting with the matching private key"
age --decrypt -i <(echo "$AGE_PRIVATE_KEY") -o "$WORKDIR/backup.dump" "$WORKDIR/backup.dump.age"

echo "backup.test.sh: verifying the decrypted archive with pg_restore --list"
docker run --rm -v "$WORKDIR:/work" postgres:16-alpine pg_restore --list /work/backup.dump >/dev/null

echo "PASS: decrypted archive is a valid pg_dump custom-format dump"
