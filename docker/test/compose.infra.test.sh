#!/usr/bin/env bash
# [75.29] Compose / image-pin checks. CI-only (the `infra` job runs every
# *.infra.test.sh). Static checks first; the backup-image checks build and run
# one small container, so they need a Docker daemon.
set -euo pipefail
cd "$(dirname "$0")/../.."

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "ok: $1"; }

export POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x JWT_SECRET=x \
  S3_ACCESS_KEY_ID=x S3_SECRET_ACCESS_KEY=x \
  BACKUP_AGE_PUBLIC_KEY=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq

docker compose config -q && pass "compose config is valid"

# Every third-party image in compose is pinned by digest. biddaloy-app and
# biddaloy-backup are built locally from the Dockerfiles checked below.
unpinned="$(docker compose config --images | grep -v '^biddaloy-' | grep -v -E '@sha256:[0-9a-f]{64}$' || true)"
[ -z "$unpinned" ] || fail "compose images not digest-pinned: $unpinned"
pass "compose images are digest-pinned"

for df in Dockerfile scripts/backup/Dockerfile; do
  # Skip FROMs of earlier build stages (FROM base AS deps).
  bad="$(grep -E '^FROM ' "$df" | grep -v -E '^FROM [a-z]+ AS ' | grep -v -E '@sha256:[0-9a-f]{64}' || true)"
  [ -z "$bad" ] || fail "$df has an unpinned FROM: $bad"
done
pass "app and backup Dockerfile FROMs are digest-pinned"

docker build -q -t biddaloy-backup-test scripts/backup >/dev/null
[ "$(docker run --rm --entrypoint id biddaloy-backup-test -u)" = "10001" ] \
  && pass "backup runs as uid 10001" || fail "backup is not uid 10001"

run_env=(-e DATABASE_URL=postgres://x -e BACKUP_AGE_PUBLIC_KEY=age1x -e S3_BUCKET=b
  -e S3_ENDPOINT=http://x -e S3_REGION=r -e S3_ACCESS_KEY_ID=x -e S3_SECRET_ACCESS_KEY=topsecret)

out="$(docker run --rm "${run_env[@]}" -e BACKUP_SCHEDULE='0 2 * * *' --entrypoint sh biddaloy-backup-test \
  -c '/app/entrypoint.sh & sleep 2; cat /app/crontab' 2>&1 || true)"
echo "$out" | grep -q 'starting supercronic' && pass "supercronic starts" || fail "supercronic did not start"
echo "$out" | grep -q 'topsecret' && fail "secret leaked into crontab/log" || pass "no secret in crontab"

if docker run --rm "${run_env[@]}" -e BACKUP_SCHEDULE='* * * * * ; rm -rf /' biddaloy-backup-test >/dev/null 2>&1; then
  fail "injection schedule was accepted"
fi
pass "injected BACKUP_SCHEDULE is rejected"
