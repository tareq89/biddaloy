#!/usr/bin/env bash
# Test for staging-refresh.sh against a real Postgres, using only what a bare CI runner has:
# docker, bash, flock, curl. No node, no yarn, no age, no host psql.
#
#   bash scripts/backup/staging-refresh.infra.test.sh
#
# Same shape as db-swap.infra.test.sh: it uses the shared stack's db container when one is
# running, otherwise starts a throwaway Postgres from the image docker-compose.yml pins and
# removes it on exit. It creates and drops databases named biddaloy_staging_t<pid>*, plus biddaloy_staging_drill
# (cases 8-9; the case refuses to run if that database already exists).
#
# What is faked, and why:
#   * psql, pg_dump and pg_restore are shims that run inside the Postgres container.
#   * `age` is a shim that "decrypts" by copying (the file in the fake bucket is a plain dump).
#   * `aws` reads a folder instead of R2; `curl` records the Kuma push. Nothing leaves the machine.
#   * The scrub is a small stand-in over a three-table schema (SCRUB_SQL). The real scrub.sql
#     needs the full migrated schema, which needs node: server/test/staging-scrub.integration.spec.ts
#     runs the real file against every table with worst-case rows. This test covers the script
#     itself: guards, waiting, the missing-backup path, restore, scrub hand-off, verify, ready.
#
# Cases: 1 production name refused (exit 2); 2 non-bcrypt hash refused before aws runs;
# 3 no daily backup and the deadline passed: exit 1 + `down` push + staging untouched;
# 4 bucket unreadable: a different message, still `down`; 5 backup present: `staging_next ready`,
# every user has the staging hash, the live database is untouched; 6 a failing scrub drops _next
# and pushes `down`; 7 bad --target/--from refused; 8 --target drill from an exact key; 9 latest-hourly,
# a failed --target run pushes nothing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REFRESH="$HERE/staging-refresh.sh"
DB_CONTAINER="$(docker ps -q --filter label=com.docker.compose.project=biddaloy \
  --filter label=com.docker.compose.service=db | head -1)"
OWN_DB=""
if [[ -z "$DB_CONTAINER" ]]; then
  PG_IMAGE="$(sed -n 's/^ *image: \(postgres:.*\)$/\1/p' "$HERE/../../docker-compose.yml" | head -1)"
  [[ -n "$PG_IMAGE" ]] || { echo "staging-refresh.infra.test.sh: no postgres image in docker-compose.yml" >&2; exit 1; }
  OWN_DB="staging-refresh-infra-test-pg-$$"
  docker run -d --rm --name "$OWN_DB" -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo "$PG_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$OWN_DB" pg_isready -q -h 127.0.0.1 -U demo 2>/dev/null && break
    sleep 1
  done
  docker exec "$OWN_DB" pg_isready -q -h 127.0.0.1 -U demo || { echo "staging-refresh.infra.test.sh: Postgres did not start" >&2; exit 1; }
  DB_CONTAINER="$OWN_DB"
fi
ENV_OF_DB="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER")"
PG_USER="$(sed -n 's/^POSTGRES_USER=//p' <<<"$ENV_OF_DB")"
PG_PASS="$(sed -n 's/^POSTGRES_PASSWORD=//p' <<<"$ENV_OF_DB")"

TAG="t$$"
LIVE="biddaloy_staging_${TAG}"
SRC="biddaloy_staging_${TAG}_src"
PLATFORM_ID="00000000-0000-4000-8000-000000000001"
# A bcrypt cost-12 shaped hash: $2b$12$ + 53 characters.
HASH="\$2b\$12\$$(printf 'a%.0s' $(seq 1 53))"
# The env carries it base64-encoded (compose would expand the `$`s), as the stack does.
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
DAY="$(date -u -d "@$(($(date +%s) + 21600))" +%F 2>/dev/null || date -u -r "$(($(date +%s) + 21600))" +%F)"

WORK="$(mktemp -d)"
FAKE_BUCKET="$WORK/bucket"
mkdir -p "$WORK/bin" "$FAKE_BUCKET/db/daily"
cleanup() {
  for d in "$LIVE" "${LIVE}_next" "$SRC"; do
    docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -h 127.0.0.1 -U "$PG_USER" -d postgres -qc "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1 || true
  done
  [[ -z "$OWN_DB" ]] || docker rm -f "$OWN_DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# psql: runs in the container. A `-f <file>` on the host is fed through stdin instead.
cat >"$WORK/bin/psql" <<EOS
#!/usr/bin/env bash
args=(); file=""
while [[ \$# -gt 0 ]]; do if [[ "\$1" == -f ]]; then file="\$2"; shift 2; else args+=("\$1"); shift; fi; done
if [[ -n "\$file" ]]; then
  exec docker exec -i -e PGPASSWORD="\${PGPASSWORD:-$PG_PASS}" "$DB_CONTAINER" psql "\${args[@]}" < "\$file"
fi
exec docker exec -i -e PGPASSWORD="\${PGPASSWORD:-$PG_PASS}" "$DB_CONTAINER" psql "\${args[@]}" </dev/null
EOS
# pg_restore: the dump file (last argument) is fed through stdin.
cat >"$WORK/bin/pg_restore" <<EOS
#!/usr/bin/env bash
file="\${*: -1}"; args=("\${@:1:\$#-1}")
exec docker exec -i -e PGPASSWORD="\${PGPASSWORD:-$PG_PASS}" "$DB_CONTAINER" pg_restore "\${args[@]}" < "\$file"
EOS
# age: "decrypt" by copying. Usage: age --decrypt -i <key> -o <out> <in>
cat >"$WORK/bin/age" <<'EOS'
#!/usr/bin/env bash
out=""; while [[ $# -gt 0 ]]; do [[ "$1" == -o ]] && out="$2"; last="$1"; shift; done
cp "$last" "$out"
EOS
# aws: `s3 ls` and `s3 cp` read $FAKE_BUCKET/<key>. AWS_SHIM_ERROR=1 simulates a 403.
cat >"$WORK/bin/aws" <<'EOS'
#!/usr/bin/env bash
echo "aws $*" >>"$SHIM_LOG"
args=(); while [[ $# -gt 0 ]]; do if [[ "$1" == --endpoint-url ]]; then shift 2; else args+=("$1"); shift; fi; done
if [[ "${AWS_SHIM_ERROR:-}" == 1 ]]; then echo "An error occurred (AccessDenied) when calling the ListObjectsV2 operation" >&2; exit 254; fi
case "${args[0]} ${args[1]}" in
  "s3 ls"|"s3 cp")
    src="$FAKE_BUCKET/$(sed 's#^s3://[^/]*/##' <<<"${args[2]}")"
    if [[ -d "$src" ]]; then ls "$src" | sed 's/^/2026-01-01 00:00:00 1 /'; exit 0; fi
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
echo "key" >"$WORK/key.txt"

# A stand-in scrub over the stand-in schema (see the header).
cat >"$WORK/stub-scrub.sql" <<'EOS'
UPDATE users SET email = 'u-' || id::text || '@staging.invalid', password_hash = :'staging_password_hash';
EOS
cat >"$WORK/bad-scrub.sql" <<'EOS'
UPDATE no_such_table SET x = 1;
EOS

pg() { docker exec -i -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -h 127.0.0.1 -U "$PG_USER" -v ON_ERROR_STOP=1 -tAq "$@"; }
pg -d postgres -c "CREATE DATABASE \"$SRC\"" >/dev/null
pg -d "$SRC" >/dev/null <<'EOS'
CREATE TABLE schools (id uuid PRIMARY KEY, slug text);
CREATE TABLE users (id uuid PRIMARY KEY, email text, password_hash text);
CREATE TABLE students (id uuid PRIMARY KEY, full_name text);
INSERT INTO schools VALUES (gen_random_uuid(), 'a');
INSERT INTO users VALUES (gen_random_uuid(), 'real1@school.example', 'old'), (gen_random_uuid(), 'real2@school.example', 'old');
INSERT INTO students VALUES (gen_random_uuid(), 'Real Name');
EOS
pg -d postgres -c "CREATE DATABASE \"$LIVE\"" >/dev/null
pg -d "$LIVE" -c "CREATE TABLE marker (v int); INSERT INTO marker VALUES (42)" >/dev/null

RARGS=() # script arguments (--target ...) for the next run_refresh
run_refresh() { # run_refresh VAR=value ... ; output goes to $WORK/out
  env PATH="$WORK/bin:$PATH" \
    POSTGRES_DB="$LIVE" POSTGRES_USER="$PG_USER" POSTGRES_PASSWORD="$PG_PASS" POSTGRES_HOST=127.0.0.1 \
    BACKUP_S3_ENDPOINT=https://r2.invalid BACKUP_S3_BUCKET=bucket \
    BACKUP_S3_ACCESS_KEY_ID=read-only BACKUP_S3_SECRET_ACCESS_KEY=read-only-secret \
    BACKUP_AGE_PRIVATE_KEY_FILE="$WORK/key.txt" STAGING_PASSWORD_HASH_B64="$(b64 "$HASH")" \
    SMOKE_SCHOOL_SLUG=smoke-test-school PLATFORM_TENANT_ID="$PLATFORM_ID" \
    STAGING_REFRESH_PUSH_URL=https://kuma.invalid/api/push/token STAGING_REFRESH_POLL_SECS=1 \
    STAGING_REFRESH_DEADLINE=23:59 SCRUB_SQL="$WORK/stub-scrub.sql" \
    "$@" bash "$REFRESH" ${RARGS[@]+"${RARGS[@]}"} >"$WORK/out" 2>&1
}
next_exists() { [[ "$(pg -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = '${LIVE}_next'")" != 0 ]]; }
live_untouched() { [[ "$(pg -d "$LIVE" -c 'SELECT v FROM marker')" == 42 ]]; }

# 1. the production database name is refused, exit 2, and nothing runs.
set +e; run_refresh POSTGRES_DB=biddaloy; code=$?; set -e
[[ $code -eq 2 ]] || fail "production name must exit 2, got $code"
grep -q 'refusing: not a staging database' "$WORK/out" || fail "no refusal message"
[[ ! -s "$SHIM_LOG" ]] || fail "aws or curl ran before the guard"
echo "PASS: non-staging database refused"

# 2. a hash that is not bcrypt cost 12 is refused before anything is read or restored.
BAD_HASH="\$2b\$12\$short"
set +e; run_refresh STAGING_PASSWORD_HASH_B64="$(b64 "$BAD_HASH")"; code=$?; set -e
[[ $code -eq 2 ]] || fail "bad hash must exit 2, got $code"
if grep -q '^aws' "$SHIM_LOG"; then fail "aws ran with a bad hash"; fi
echo "PASS: malformed hash refused"

# 3. no daily backup and the deadline already passed: exit 1, a down push, staging untouched.
set +e; run_refresh STAGING_REFRESH_DEADLINE=00:00; code=$?; set -e
[[ $code -eq 1 ]] || fail "missing backup must exit 1, got $code"
grep -q "no daily backup for $DAY" "$WORK/out" || fail "no 'no daily backup' message"
grep -q 'status=down' "$SHIM_LOG" || fail "no down push"
grep -q 'no daily backup' "$SHIM_LOG" || fail "down push does not say why"
live_untouched || fail "live staging database changed"
next_exists && fail "_next left behind"
echo "PASS: missing backup pushes down and leaves staging alone"

# 4. a bucket that cannot be read is not reported as a missing backup.
: >"$SHIM_LOG"
set +e; run_refresh STAGING_REFRESH_DEADLINE=00:00 AWS_SHIM_ERROR=1; code=$?; set -e
[[ $code -eq 1 ]] || fail "unreadable bucket must exit 1, got $code"
grep -q 'cannot read the backup bucket' "$WORK/out" || fail "no bucket-error message"
grep -q 'status=down' "$SHIM_LOG" || fail "no down push for a bucket error"
echo "PASS: bucket error is its own message and still pushes down"

# 5. with the daily backup present the copy is ready, scrubbed and has the staging password.
docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" pg_dump -Fc -h 127.0.0.1 -U "$PG_USER" "$SRC" >"$FAKE_BUCKET/db/daily/$DAY.dump.age"
run_refresh || { cat "$WORK/out" >&2; fail "refresh failed"; }
grep -q '^staging_next ready$' "$WORK/out" || fail "no 'staging_next ready'"
for n in 1 2 3 4 5 6 7; do grep -q "^step $n/7:" "$WORK/out" || fail "step $n not printed"; done
bad="$(pg -d "${LIVE}_next" -c "SELECT count(*) FROM users WHERE password_hash IS DISTINCT FROM '$HASH' OR email NOT LIKE '%@staging.invalid'")"
[[ "$bad" == 0 ]] || fail "$bad users were not scrubbed"
if grep -q 'real1@school.example' "$WORK/out"; then fail "a real email was printed"; fi
live_untouched || fail "refresh touched the live database"
echo "PASS: staging_next ready, scrubbed, live database untouched"

# 6. a scrub that fails drops _next, pushes down, and leaves staging alone.
: >"$SHIM_LOG"
set +e; run_refresh SCRUB_SQL="$WORK/bad-scrub.sql"; code=$?; set -e
[[ $code -eq 1 ]] || fail "failing scrub must exit 1, got $code"
grep -q 'scrub FAILED' "$WORK/out" || fail "no scrub failure message"
grep -q 'status=down' "$SHIM_LOG" || fail "no down push for a failed scrub"
next_exists && fail "_next left behind after a failed scrub"
live_untouched || fail "failed scrub touched the live database"
echo "PASS: failed scrub cleans up and pushes down"

# 7. --target biddaloy_prod is refused (exit 2) before anything runs; so is a staging-looking name that
#    is not one of the two allowed ones.
: >"$SHIM_LOG"
for badfrom in 'db/daily/../x.dump.age' 'db/daily/x.dump.age;rm' 's3://evil/x.dump.age' 'db/weekly/x.dump.age' 'db/daily/a b.dump.age'; do
  RARGS=(--from "$badfrom"); set +e; run_refresh; code=$?; set -e
  [[ $code -eq 2 ]] || fail "--from '$badfrom' must exit 2, got $code"
done
RARGS=(--target ""); set +e; run_refresh; code=$?; set -e
[[ $code -eq 2 ]] || fail "empty --target must exit 2, got $code"
for bad in biddaloy_prod biddaloy biddaloy_staging_other biddaloy_staging_next 'biddaloy_staging_drill;x'; do
  RARGS=(--target "$bad"); set +e; run_refresh; code=$?; set -e
  [[ $code -eq 2 ]] || fail "--target $bad must exit 2, got $code"
done
[[ ! -s "$SHIM_LOG" ]] || fail "aws or curl ran for a refused --target"
RARGS=()
echo "PASS: --target outside the two staging names refused"

# 8. --target biddaloy_staging_drill with an exact --from key: restored, scrubbed, no _next, no swap,
#    the live database untouched, the dated daily key never asked for.
DRILL=biddaloy_staging_drill
[[ "$(pg -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = '$DRILL'")" == 0 ]] || fail "$DRILL already exists on this server; not running case 8"
trap 'pg -d postgres -c "DROP DATABASE IF EXISTS \"$DRILL\" WITH (FORCE)" >/dev/null 2>&1 || true; cleanup' EXIT
cp "$FAKE_BUCKET/db/daily/$DAY.dump.age" "$FAKE_BUCKET/db/daily/exact-key.dump.age"
: >"$SHIM_LOG"
RARGS=(--target "$DRILL" --from db/daily/exact-key.dump.age); run_refresh || { cat "$WORK/out" >&2; fail "drill refresh failed"; }
grep -q "^${DRILL} ready$" "$WORK/out" || fail "no '$DRILL ready'"
grep -q "db/daily/exact-key.dump.age" "$SHIM_LOG" || fail "the exact key was not used"
if grep -q "$DAY.dump.age" "$SHIM_LOG"; then fail "the dated daily key was used instead"; fi
bad="$(pg -d "$DRILL" -c "SELECT count(*) FROM users WHERE password_hash IS DISTINCT FROM '$HASH' OR email NOT LIKE '%@staging.invalid'")"
[[ "$bad" == 0 ]] || fail "$bad drill users were not scrubbed"
next_exists && fail "_next created in --target mode"
live_untouched || fail "--target touched the live database"
echo "PASS: --target drill restored and scrubbed from an exact key"

# 9. --from latest-hourly picks the newest db/hourly object without waiting; a failing scrub still
#    drops the target, and pushes nothing: with --target the caller reports (PR #3281 review).
mkdir -p "$FAKE_BUCKET/db/hourly"
cp "$FAKE_BUCKET/db/daily/$DAY.dump.age" "$FAKE_BUCKET/db/hourly/2026-01-01T01.dump.age"
cp "$FAKE_BUCKET/db/daily/$DAY.dump.age" "$FAKE_BUCKET/db/hourly/2026-01-01T02.dump.age"
: >"$SHIM_LOG"
RARGS=(--target "$DRILL" --from latest-hourly); run_refresh || { cat "$WORK/out" >&2; fail "hourly refresh failed"; }
grep -q "cp .*db/hourly/2026-01-01T02.dump.age" "$SHIM_LOG" || fail "newest hourly key not chosen"
: >"$SHIM_LOG"
RARGS=(--target "$DRILL" --from latest-hourly); set +e; run_refresh SCRUB_SQL="$WORK/bad-scrub.sql"; code=$?; set -e
[[ $code -eq 1 ]] || fail "failing scrub must exit 1, got $code"
[[ "$(pg -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = '$DRILL'")" == 0 ]] || fail "$DRILL survived a failed scrub"
grep -q 'status=down' "$SHIM_LOG" && fail "--target must not push down (the caller reports)"
echo "PASS: latest-hourly, and a failed scrub drops the target without a push"

echo "staging-refresh.infra.test.sh: all cases passed"
