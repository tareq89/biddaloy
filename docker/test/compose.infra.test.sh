#!/usr/bin/env bash
# [75.29] Compose / image-pin checks. CI-only (the `infra` job runs every
# *.infra.test.sh). Static checks first; the backup-image checks build and run
# one small container, so they need a Docker daemon.
set -euo pipefail
cd "$(dirname "$0")/../.."

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "ok: $1"; }

export APP_VERSION=test TLS_CERT_DIR=./.certs POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x JWT_SECRET=x \
  S3_ACCESS_KEY_ID=x S3_SECRET_ACCESS_KEY=x \
  BACKUP_AGE_PUBLIC_KEY=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq

docker compose config -q && pass "compose config is valid" || fail "compose config is invalid"
# [58.4.01] The demo overlay (docker-compose.demo.yml) must merge onto the base file.
DEMO_PASSWORD=x S3_BUCKET=biddaloy-demo \
  docker compose -f docker-compose.yml -f docker-compose.demo.yml config -q \
  && pass "demo overlay config is valid" || fail "demo overlay config is invalid"

# prod + local-build overlay must merge too.
docker compose -f docker-compose.yml -f docker-compose.build.yml config -q \
  && pass "build overlay config is valid" || fail "build overlay config is invalid"

# Every third-party image in compose is pinned by digest. First-party GHCR
# images must carry exactly the APP_VERSION tag (the commit SHA in prod), so a
# mutable `:main` / `:latest` fails here too (Rule 21).
unpinned="$(docker compose config --images | grep -v -E "^ghcr\.io/tareq89/biddaloy-[a-z-]+:${APP_VERSION}\$" | grep -v -E '@sha256:[0-9a-f]{64}$' || true)"
[ -z "$unpinned" ] || fail "compose images not digest-pinned: $unpinned"
pass "compose images are digest-pinned"

for df in Dockerfile scripts/backup/Dockerfile; do
  # Skip only FROMs that name an earlier build stage (FROM base AS deps), so a
  # real image with an alias (FROM alpine AS tools) is still checked.
  bad="$(awk '$1=="FROM" { if (!($2 in stage) && $2 !~ /@sha256:[0-9a-f]{64}$/) print; if ($3=="AS") stage[$4]=1 }' "$df")"
  [ -z "$bad" ] || fail "$df has an unpinned FROM: $bad"
done
pass "app and backup Dockerfile FROMs are digest-pinned"

docker build -q -t biddaloy-backup-test scripts/backup >/dev/null
[ "$(docker run --rm --entrypoint id biddaloy-backup-test -u)" = "10001" ] \
  && pass "backup runs as uid 10001" || fail "backup is not uid 10001"

run_env=(-e DATABASE_URL=postgres://x -e BACKUP_AGE_PUBLIC_KEY=age1x -e S3_BUCKET=b
  -e S3_ENDPOINT=http://x -e S3_REGION=r -e S3_ACCESS_KEY_ID=x -e S3_SECRET_ACCESS_KEY=topsecret)

# No BACKUP_SCHEDULE and no R2 vars: legacy mode keeps the once-a-day default.
out="$(docker run --rm "${run_env[@]}" --entrypoint sh biddaloy-backup-test \
  -c '/app/entrypoint.sh & sleep 2; cat /app/crontab' 2>&1 || true)"
echo "$out" | grep -q 'starting supercronic' && pass "supercronic starts" || fail "supercronic did not start"
echo "$out" | grep -qx '0 2 \* \* \* /app/backup.sh' && pass "legacy default schedule is daily" || fail "legacy default schedule is not 0 2 * * *"
echo "$out" | grep -q 'topsecret' && fail "secret leaked into crontab/log" || pass "no secret in crontab"

# A regressed check would exec supercronic, which never exits: the timeout
# turns that hang into a FAIL. 0 = accepted and exited, 124 = accepted and
# still running; anything else is the entrypoint rejecting the schedule.
rc=0
timeout -k 5 20 docker run --rm "${run_env[@]}" -e BACKUP_SCHEDULE='* * * * * ; rm -rf /' \
  biddaloy-backup-test >/dev/null 2>&1 || rc=$?
{ [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ]; } || fail "injection schedule was accepted (exit $rc)"
pass "injected BACKUP_SCHEDULE is rejected"

# A copied .env.example placeholder for the crypt password must stop the
# container before supercronic starts (exit 1, not a hang).
rc=0
out="$(timeout -k 5 20 docker run --rm "${run_env[@]}" -e BACKUP_S3_ENDPOINT=https://r2.example \
  -e BACKUP_S3_BUCKET=b -e BACKUP_S3_ACCESS_KEY_ID=k -e BACKUP_S3_SECRET_ACCESS_KEY=0123456789abcdef0123 \
  -e BACKUP_RCLONE_CRYPT_PASSWORD=change-me -e BACKUP_RCLONE_CRYPT_SALT=0123456789abcdef0123 \
  biddaloy-backup-test 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "placeholder crypt password was accepted (exit $rc)"
grep -q 'BACKUP_RCLONE_CRYPT_PASSWORD is a placeholder' <<<"$out" \
  || fail "exit 1 was not the placeholder check: $out"
pass "placeholder crypt password is rejected"
