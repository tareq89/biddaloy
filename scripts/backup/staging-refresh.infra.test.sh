#!/usr/bin/env bash
# Test for staging-refresh.sh against a real Postgres. Same host setup as the restore drill
# (.github/workflows/restore-drill.yml): psql, pg_dump, pg_restore (all major 18), age and aws on
# PATH, Postgres on localhost:5432, Redis on localhost:6379 (the e2e seed boots AppModule), and
# `yarn install` + `yarn build:shared` done. Run it with:
#
#   bash scripts/backup/staging-refresh.infra.test.sh
#
# It creates and drops only databases named biddaloy_staging_t<pid>*. R2 is replaced by a folder:
# a PATH shim for `aws` answers `s3 ls` and `s3 cp` from it, and nothing leaves the machine. The
# shim `curl` records the Kuma push. Cases:
#   1. a non-staging database name (the production name) is refused with exit 2
#   2. a password hash that is not bcrypt is refused before aws or the database are touched
#   3. no daily backup and a deadline that has passed: exit 1, `no daily backup`, a `down` push,
#      and the live staging database is untouched
#   4. with the daily backup present: `staging_next ready`; the copy holds no original email
#      apart from the platform super admins and the smoke school, and every user has the staging
#      password hash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REFRESH="$HERE/staging-refresh.sh"
PG="${TEST_PG_URL:-postgres://postgres:postgres@localhost:5432}"
TAG="t$$"
LIVE="biddaloy_staging_${TAG}"
SRC="biddaloy_staging_${TAG}_src"
PLATFORM_ID="00000000-0000-4000-8000-000000000001" # DEV_SEED_PLATFORM_TENANT_ID
# shellcheck disable=SC2016  # a bcrypt hash is literal text
HASH='$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234'
DAY="$(TZ=Asia/Dhaka date +%F)"

WORK="$(mktemp -d)"
FAKE_BUCKET="$WORK/bucket"
mkdir -p "$WORK/bin" "$FAKE_BUCKET/db/daily"
psql_admin() { psql "$PG/postgres" -v ON_ERROR_STOP=1 -tAqc "$1"; }
cleanup() {
  for d in "$LIVE" "${LIVE}_next" "$SRC"; do psql_admin "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# aws shim: `s3 ls s3://b/<key>` and `s3 cp s3://b/<key> <file>` read $FAKE_BUCKET/<key>.
cat >"$WORK/bin/aws" <<'EOS'
#!/usr/bin/env bash
echo "aws $*" >>"$SHIM_LOG"
# drop `--endpoint-url X` wherever it sits (restore.sh and the refresh script put it after the verb)
args=(); while [[ $# -gt 0 ]]; do if [[ "$1" == --endpoint-url ]]; then shift 2; else args+=("$1"); shift; fi; done
key_of() { sed 's#^s3://[^/]*/##' <<<"$1"; }
case "${args[0]} ${args[1]}" in
  "s3 ls"|"s3 cp")
    src="$FAKE_BUCKET/$(key_of "${args[2]}")"
    [[ -f "$src" ]] || exit 1
    [[ "${args[1]}" == cp ]] && cp "$src" "${args[3]}"
    exit 0 ;;
esac
exit 0
EOS
cat >"$WORK/bin/curl" <<'EOS'
#!/usr/bin/env bash
echo "curl $*" >>"$SHIM_LOG"
printf '200'
EOS
chmod +x "$WORK/bin/"*
export SHIM_LOG="$WORK/shim.log" FAKE_BUCKET
: >"$SHIM_LOG"

# --- a source database with the real schema and seed, dumped and encrypted like backup.sh ------
psql_admin "CREATE DATABASE \"$SRC\"" >/dev/null
age-keygen -o "$WORK/key.txt" 2>"$WORK/keygen.log"
AGE_PUB="$(grep 'Public key:' "$WORK/keygen.log" | sed 's/.*: //')"
(
  cd "$ROOT"
  export DATABASE_URL="$PG/$SRC" NODE_ENV=test JWT_SECRET="${JWT_SECRET:-staging-refresh-test-jwt-secret-1234567890}" \
    SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-staging-refresh-test-seed-password-1}"
  yarn --silent workspace @biddaloy/server migration:run >/dev/null
  yarn --silent workspace @biddaloy/server seed >/dev/null
)
EXPECTED_KEPT="$(psql "$PG/$SRC" -tAqc "SELECT count(DISTINCT user_id) FROM user_tenants WHERE tenant_id = '$PLATFORM_ID' AND role = 'SUPER_ADMIN' AND deleted_at IS NULL")"

# The live staging database that must survive every failed run.
psql_admin "CREATE DATABASE \"$LIVE\"" >/dev/null
psql "$PG/$LIVE" -qc "CREATE TABLE marker (v int); INSERT INTO marker VALUES (42)" >/dev/null

run_refresh() { # run_refresh VAR=value ... ; output goes to $WORK/out
  env PATH="$WORK/bin:$PATH" \
    POSTGRES_DB="$LIVE" POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres POSTGRES_HOST=localhost \
    BACKUP_S3_ENDPOINT=https://r2.invalid BACKUP_S3_BUCKET=bucket \
    BACKUP_S3_ACCESS_KEY_ID=read-only BACKUP_S3_SECRET_ACCESS_KEY=read-only-secret \
    BACKUP_AGE_PRIVATE_KEY_FILE="$WORK/key.txt" STAGING_PASSWORD_HASH="$HASH" \
    SMOKE_SCHOOL_SLUG=smoke-test-school PLATFORM_TENANT_ID="$PLATFORM_ID" \
    STAGING_REFRESH_PUSH_URL=https://kuma.invalid/api/push/token STAGING_REFRESH_POLL_SECS=1 \
    STAGING_REFRESH_DEADLINE=23:59 "$@" bash "$REFRESH" >"$WORK/out" 2>&1
}

# 1. the production database name is refused, exit 2, and nothing runs.
set +e; run_refresh POSTGRES_DB=biddaloy; code=$?; set -e
[[ $code -eq 2 ]] || fail "production name must exit 2, got $code"
grep -q 'refusing: not a staging database' "$WORK/out" || fail "no refusal message"
[[ ! -s "$SHIM_LOG" ]] || fail "aws or curl ran before the guard"
echo "PASS: non-staging database refused"

# 2. a hash that is not bcrypt is refused before anything is read or restored.
set +e; run_refresh STAGING_PASSWORD_HASH=plaintext; code=$?; set -e
[[ $code -eq 2 ]] || fail "bad hash must exit 2, got $code"
[[ ! -s "$SHIM_LOG" ]] || fail "aws ran with a bad hash"
echo "PASS: non-bcrypt hash refused"

# 3. no daily backup and the deadline already passed: exit 1, a down push, staging untouched.
set +e; run_refresh STAGING_REFRESH_DEADLINE=00:00; code=$?; set -e
[[ $code -eq 1 ]] || fail "missing backup must exit 1, got $code"
grep -q "no daily backup for $DAY" "$WORK/out" || fail "no 'no daily backup' message"
grep -q 'status=down' "$SHIM_LOG" || fail "no down push"
grep -q 'no daily backup' "$SHIM_LOG" || fail "down push does not say why"
[[ "$(psql "$PG/$LIVE" -tAqc 'SELECT v FROM marker')" == 42 ]] || fail "live staging database changed"
[[ "$(psql_admin "SELECT count(*) FROM pg_database WHERE datname = '${LIVE}_next'")" == 0 ]] || fail "_next left behind"
echo "PASS: missing backup pushes down and leaves staging alone"

# 4. with the daily backup present the copy is ready, scrubbed and has the staging password.
pg_dump -Fc "$PG/$SRC" | age -r "$AGE_PUB" >"$FAKE_BUCKET/db/daily/$DAY.dump.age"
run_refresh || { cat "$WORK/out" >&2; fail "refresh failed"; }
grep -q '^staging_next ready$' "$WORK/out" || fail "no 'staging_next ready'"
for n in 1 2 3 4 5 6 7; do grep -q "^step $n/7:" "$WORK/out" || fail "step $n not printed"; done
NEXT="$PG/${LIVE}_next"
kept="$(psql "$NEXT" -tAqc "SELECT count(*) FROM users WHERE email NOT LIKE '%@staging.invalid'")"
[[ "$kept" == "$EXPECTED_KEPT" ]] || fail "expected $EXPECTED_KEPT kept emails, got $kept"
bad="$(psql "$NEXT" -tAqc "SELECT count(*) FROM users WHERE password_hash IS DISTINCT FROM '$HASH'")"
[[ "$bad" == 0 ]] || fail "$bad users still have another password"
[[ "$(psql "$PG/$LIVE" -tAqc 'SELECT v FROM marker')" == 42 ]] || fail "refresh touched the live database"
echo "PASS: staging_next ready, scrubbed, live database untouched"

echo "staging-refresh.infra.test.sh: all cases passed"
