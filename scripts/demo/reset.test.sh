#!/usr/bin/env bash
# Test for reset.sh against a real Postgres, with the app-level steps replaced by tiny fakes
# (migrate = nothing, seed = a few rows, validator = true/false). It proves the parts that
# destroy things: the swap, the failure path, and the refusals.
#
#   scripts/demo/reset.test.sh
#
# Needs the shared local stack (`yarn test-env up` started it, or `docker compose up -d db`):
# it only runs `docker exec` into the running db container, and only ever creates, renames and
# drops databases named biddaloy_demo_t<pid>*; the refusal cases get a psql that always fails.
# aws, redis-cli and curl are stubs that log their arguments. The real seed and validator are
# exercised by the demo-seed specs (validator.spec.ts, validate-cli.spec.ts).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DB_CONTAINER="$(docker ps -q --filter label=com.docker.compose.service=db | head -1)"
[[ -n "$DB_CONTAINER" ]] || { echo "reset.test.sh: no running db container (run yarn test-env up first)" >&2; exit 1; }
PG_USER="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER" | sed -n 's/^POSTGRES_USER=//p')"
PG_PASS="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER" | sed -n 's/^POSTGRES_PASSWORD=//p')"

WORK="$(mktemp -d)"
LOG="$WORK/log"; mkdir -p "$LOG" "$WORK/bin" "$WORK/state"
: > "$LOG/psql.log"; : > "$LOG/aws.log"; : > "$LOG/redis.log"; : > "$LOG/curl.log"

# Stubs. psql runs inside the db container; everything else just records its arguments.
# PSQL_FAIL_ON / REDIS_FAIL_ON (a regex on the arguments) and AWS_FAIL=1 make calls fail.
# PSQL_FAIL_ONCE=1: only the first matching psql call fails.
cat > "$WORK/bin/psql" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$LOG/psql.log"
if [[ -n "\${PSQL_FAIL_ON:-}" && "\$*" =~ \$PSQL_FAIL_ON && ! -e "$LOG/failed-once" ]]; then
  [[ -z "\${PSQL_FAIL_ONCE:-}" ]] || touch "$LOG/failed-once"
  echo "psql stub: forced failure" >&2; exit 3
fi
exec docker exec -i "$DB_CONTAINER" psql "\$@"
EOF
# The refusal cases below aim at real names (biddaloy, postgres). They get this psql instead, so a
# broken guard fails the test without ever reaching the shared Postgres.
cat > "$WORK/bin/psql-forbidden" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$LOG/forbidden.log"
exit 97
EOF
cat > "$WORK/bin/redis-cli" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$LOG/redis.log"
if [[ -n "\${REDIS_FAIL_ON:-}" && "\$*" =~ \$REDIS_FAIL_ON ]]; then exit 1; fi
EOF
cat > "$WORK/bin/aws" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$LOG/aws.log"
[[ -z "\${AWS_FAIL:-}" ]]
EOF
cat > "$WORK/bin/curl" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$LOG/curl.log"
EOF
# macOS has no flock(1) or timeout(1); the image has both. Stand-ins for the forms reset.sh uses.
if ! command -v flock >/dev/null; then
  cat > "$WORK/bin/flock" <<'EOF'
#!/usr/bin/perl
# flock -n FD: lock the open file behind FD without waiting (the lock stays with the caller's FD).
use Fcntl ':flock';
open(my $fh, '>&=', $ARGV[-1]) or exit 1;
flock($fh, LOCK_EX | LOCK_NB) or exit 1;
EOF
fi
if ! command -v timeout >/dev/null; then
  printf '#!/usr/bin/env bash\nshift; exec "$@"\n' > "$WORK/bin/timeout"
fi
chmod +x "$WORK/bin/"*

TAG="t$$"
LIVE="biddaloy_demo_${TAG}"
BASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:5432"

pg() { docker exec -i "$DB_CONTAINER" psql -U "$PG_USER" -d "${2:-postgres}" -v ON_ERROR_STOP=1 -tAqc "$1"; }
db_exists() { [[ "$(pg "SELECT 1 FROM pg_database WHERE datname = '$1'")" == 1 ]]; }
marker() { pg "SELECT v FROM marker" "$1"; }

cleanup() {
  local d
  for d in "$LIVE" "${LIVE}_next" "${LIVE}_prev" "${LIVE}_prev_old"; do
    pg "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }
expect() { [[ "$1" == "$2" ]] || fail "$3 (expected '$2', got '$1')"; }

OLD_TENANT="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

# A "yesterday" live database: one marker row, one demo branch with a known tenant id.
make_live() {
  pg "DROP DATABASE IF EXISTS \"$LIVE\" WITH (FORCE)"
  pg "CREATE DATABASE \"$LIVE\""
  pg "CREATE TABLE marker(v text); INSERT INTO marker VALUES ('$1');
      CREATE TABLE schools(id uuid DEFAULT gen_random_uuid(), slug text);
      INSERT INTO schools(id, slug) VALUES ('$OLD_TENANT', 'bmsc-old')" "$LIVE"
}

# Fake seed: what a built demo database looks like to reset.sh.
cat > "$WORK/seed.sh" <<'SEED'
"$DEMO_PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  CREATE TABLE marker(v text); INSERT INTO marker VALUES ('$RUN_MARK');
  CREATE TABLE schools(id uuid DEFAULT gen_random_uuid(), slug text);
  INSERT INTO schools(slug) VALUES ('default-school'), ('bmsc-a'), ('bmsc-b')"
printf '%s' "$REDIS_URL" > "$DEMO_STATE_DIR/seed-redis-url"
SEED
FAKE_SEED="bash $WORK/seed.sh"

# Runs reset.sh in a clean environment; extra KEY=VALUE args override the defaults. Returns its exit code.
run_reset() {
  rm -f "$LOG/failed-once"
  env -i PATH="$WORK/bin:$PATH" HOME="$HOME" \
    DEMO_MODE=true DEMO_PASSWORD=pw DATABASE_URL="$BASE_URL/$LIVE" REDIS_URL=redis://redis.invalid:6379 \
    DEMO_STATE_DIR="$WORK/state" S3_BUCKET=biddaloy-demo-test S3_ENDPOINT=http://s3.invalid S3_ALLOW_INSECURE_HTTP=true \
    S3_REGION=us-east-1 S3_ACCESS_KEY_ID=k S3_SECRET_ACCESS_KEY=s SENTRY_CRONS_URL=http://sentry.invalid/cron \
    DEMO_PSQL="$WORK/bin/psql" DEMO_REDIS_CLI="$WORK/bin/redis-cli" DEMO_SKIP_SWEEP=true \
    DEMO_MIGRATE_CMD=true DEMO_SEED_CMD="$FAKE_SEED" DEMO_VALIDATE_CMD=true \
    DEMO_RESTART_CMD="touch $WORK/restarted" RUN_MARK=new "$@" \
    bash "$HERE/reset.sh" --now > "$WORK/out" 2> "$WORK/err"
}

# ---- 1. a good run swaps -------------------------------------------------------------------
make_live old
rm -f "$WORK/restarted"
run_reset RUN_MARK=night1 DEMO_SKIP_SWEEP= DEMO_SWEEP_CMD='test "$DEMO_SWEEP_URL" = http://127.0.0.1:3999' \
  DEMO_APP_CMD='exec sleep 300' || { cat "$WORK/out" "$WORK/err" >&2; fail "good run exited non-zero"; }
expect "$(marker "$LIVE")" night1 "live holds the new database after the swap"
expect "$(marker "${LIVE}_prev")" old "yesterday's database is kept as _prev"
db_exists "${LIVE}_next" && fail "_next should be gone after the swap"
expect "$(pg "SELECT datallowconn FROM pg_database WHERE datname = '$LIVE'")" t "live accepts connections again"
grep -q "$OLD_TENANT" "$LOG/aws.log" && fail "_prev's objects must stay while _prev is the rollback"
grep -q "redis.invalid:6379 FLUSHDB" "$LOG/redis.log" || fail "the live Redis db was not flushed"
expect "$(cat "$WORK/state/seed-redis-url")" redis://redis.invalid:6379/1 "the seed runs on the sweep's Redis db, not the live app's"
grep -q "redis.invalid:6379/1 FLUSHDB" "$LOG/redis.log" || fail "the sweep's Redis db was not flushed"
expect "$(cat "$WORK/state/platform-tenant-id")" "$(pg "SELECT id FROM schools WHERE slug = 'default-school'" "$LIVE")" "state file holds default-school's id"
[[ -e "$WORK/restarted" ]] || fail "app was not restarted"
grep -q "status=in_progress" "$LOG/curl.log" && grep -q "status=ok" "$LOG/curl.log" || fail "Sentry check-ins in_progress/ok missing"
grep -q "downtime" "$WORK/out" || fail "swap downtime was not logged"
pass "a good run swaps, keeps _prev and its objects, seeds on its own Redis db, flushes Redis, restarts, checks in"

# ---- 2. a second run keeps exactly one previous database --------------------------------------
: > "$LOG/aws.log"
run_reset RUN_MARK=night2 || fail "second run failed"
expect "$(marker "$LIVE")" night2 "second run is live"
expect "$(marker "${LIVE}_prev")" night1 "_prev is now the first run"
db_exists "${LIVE}_prev_old" && fail "_prev_old should be dropped after a good run"
grep -q "tenants/$OLD_TENANT/ --recursive" "$LOG/aws.log" || fail "the dropped _prev_old's objects were not deleted"
pass "only one previous database is kept; its objects go when it is dropped"

# ---- 3. a failing validator leaves the live database in place ---------------------------------
: > "$LOG/aws.log"; : > "$LOG/curl.log"
if run_reset RUN_MARK=bad DEMO_VALIDATE_CMD=false; then fail "failing validator should exit 1"; fi
expect "$(marker "$LIVE")" night2 "live database untouched after a validator failure"
expect "$(marker "${LIVE}_prev")" night1 "_prev untouched after a validator failure"
db_exists "${LIVE}_next" && fail "_next should be dropped after a failure"
grep -q "status=error" "$LOG/curl.log" || fail "error check-in missing"
grep -q "/tenants/" "$LOG/aws.log" || fail "the failed run's uploaded objects were not cleaned"
pass "validator failure: live untouched, _next dropped, error check-in, objects cleaned"

# ---- 4. the swap never runs when the seed exits 1 --------------------------------------------
if run_reset RUN_MARK=bad DEMO_SEED_CMD='exit 1'; then fail "failing seed should exit 1"; fi
expect "$(marker "$LIVE")" night2 "live database untouched after a seed failure"
db_exists "${LIVE}_next" && fail "_next should be dropped after a seed failure"
pass "seed exit 1: no swap"

# ---- 5. a failing sweep stops the swap --------------------------------------------------------
if run_reset RUN_MARK=bad DEMO_SKIP_SWEEP= DEMO_SWEEP_CMD='exit 7' DEMO_APP_CMD='exec sleep 300'; then fail "failing sweep should exit 1"; fi
expect "$(marker "$LIVE")" night2 "live database untouched after a sweep failure"
pass "sweep failure: no swap"

# ---- 6. a failure after the swap still brings the app back on the new database ----------------
: > "$LOG/curl.log"; rm -f "$WORK/restarted"
if run_reset RUN_MARK=night3 AWS_FAIL=1 REDIS_FAIL_ON='6379 FLUSHDB'; then fail "post-swap failures should exit 1"; fi
expect "$(marker "$LIVE")" night3 "the new database stays live"
expect "$(marker "${LIVE}_prev")" night2 "_prev is the previous night"
expect "$(cat "$WORK/state/platform-tenant-id")" "$(pg "SELECT id FROM schools WHERE slug = 'default-school'" "$LIVE")" "state file still written"
[[ -e "$WORK/restarted" ]] || fail "app was not restarted after a post-swap failure"
grep -q "these steps failed: redis-flush purge-${LIVE}_prev_old" "$WORK/err" || { cat "$WORK/err" >&2; fail "partial failure not reported"; }
grep -q "status=error" "$LOG/curl.log" || fail "error check-in missing"
pass "post-swap S3/Redis failure: state file written, app restarted, error reported"

# ---- 7. a failed rename mid-swap rolls back to yesterday's database ----------------------------
if run_reset RUN_MARK=bad PSQL_FAIL_ON="ALTER DATABASE \"${LIVE}_next\" RENAME TO"; then fail "failed swap should exit 1"; fi
expect "$(marker "$LIVE")" night3 "yesterday's database is live again"
expect "$(pg "SELECT datallowconn FROM pg_database WHERE datname = '$LIVE'")" t "rolled-back live accepts connections"
db_exists "${LIVE}_next" && fail "_next should be dropped after a rollback"
grep -q "rolled back: yesterday's database is ${LIVE} again" "$WORK/out" || { cat "$WORK/out" "$WORK/err" >&2; fail "rollback not logged"; }
grep -q "untouched" "$WORK/out" && fail "must not claim the live database was untouched"
pass "rename _next -> live fails: rolled back, live accepts connections, honest log"

if run_reset RUN_MARK=bad PSQL_FAIL_ON="ALTER DATABASE \"${LIVE}\" RENAME TO"; then fail "failed live rename should exit 1"; fi
expect "$(marker "$LIVE")" night3 "live kept when it cannot be moved aside"
expect "$(pg "SELECT datallowconn FROM pg_database WHERE datname = '$LIVE'")" t "live accepts connections again"
pass "rename live -> _prev fails: live re-enabled"

# ---- 8. only one reset at a time ---------------------------------------------------------------
exec 8>"$WORK/state/reset.lock"
PATH="$WORK/bin:$PATH" flock -n 8 || fail "test could not take the lock"
: > "$LOG/psql.log"
if run_reset RUN_MARK=bad; then fail "a second concurrent run should exit 1"; fi
exec 8>&-
grep -q "another reset is running" "$WORK/err" || { cat "$WORK/err" >&2; fail "lock refusal message missing"; }
[[ ! -s "$LOG/psql.log" ]] || fail "a refused concurrent run touched Postgres"
expect "$(marker "$LIVE")" night3 "live untouched by a refused concurrent run"
pass "a second run while one holds the lock exits without touching anything"

# ---- 9. refusals: nothing may touch any database ----------------------------------------------
refuses() { # $1 description, $2 expected message, rest: env overrides
  local what="$1" msg="$2"; shift 2
  : > "$LOG/forbidden.log"
  if run_reset DEMO_PSQL="$WORK/bin/psql-forbidden" "$@"; then fail "$what: should have refused"; fi
  grep -q "$msg" "$WORK/err" || { cat "$WORK/err" >&2; fail "$what: wrong message"; }
  [[ ! -s "$LOG/forbidden.log" ]] || fail "$what: psql was called before the refusal"
  expect "$(marker "$LIVE")" night3 "$what: live database untouched"
  pass "refuses: $what"
}
refuses "a non-demo database name" "must start with biddaloy_demo" DATABASE_URL="$BASE_URL/biddaloy"
refuses "the maintenance database" "must start with biddaloy_demo" DATABASE_URL="$BASE_URL/postgres"
refuses "DEMO_MODE not true" "DEMO_MODE is not 'true'" DEMO_MODE=false
refuses "SMS_PROVIDER set" "SMS_PROVIDER is set" SMS_PROVIDER=twilio
refuses "SMTP_HOST set" "SMTP_HOST is set" SMTP_HOST=smtp.example.com
refuses "VAPID_PUBLIC_KEY set" "VAPID_PUBLIC_KEY is set" VAPID_PUBLIC_KEY=abc
refuses "an S3 bucket without 'demo' in its name" "plain bucket name containing 'demo'" S3_BUCKET=biddaloy
refuses "an S3 bucket with a path in it" "plain bucket name containing 'demo'" S3_BUCKET=prod/demo
refuses "no sweep decision" "DEMO_SWEEP_CMD" DEMO_SKIP_SWEEP=

# ---- 10. the drop / rename helpers refuse a non-demo name even if called directly --------------
helper_refuses() { # $1 helper call
  : > "$LOG/forbidden.log"
  ( set +e
    # shellcheck disable=SC2034  # read by the sourced reset.sh
    DEMO_PSQL="$WORK/bin/psql-forbidden"; URL_BASE="$BASE_URL"; URL_QUERY=""
    # shellcheck disable=SC1091
    source "$HERE/reset.sh"
    set +e; eval "$1" ) 2>"$WORK/err" && fail "'$1' should have been refused"
  grep -q "must start with biddaloy_demo" "$WORK/err" || fail "'$1': wrong message"
  [[ ! -s "$LOG/forbidden.log" ]] || fail "'$1': psql was called"
}
helper_refuses 'drop_db biddaloy'
helper_refuses 'drop_db postgres'
helper_refuses 'drop_db "biddaloy_demo; DROP DATABASE biddaloy"'
helper_refuses "rename_db \"$LIVE\" biddaloy"
helper_refuses "rename_db biddaloy \"$LIVE\""
db_exists "$LIVE" || fail "live throwaway database disappeared"
pass "drop_db / rename_db refuse non-demo names"

# ---- 11. re-opening the new live database fails once: the app still comes back ---------------
: > "$LOG/redis.log"; : > "$LOG/curl.log"; rm -f "$WORK/restarted"
if run_reset RUN_MARK=night4 PSQL_FAIL_ON="ALTER DATABASE \"${LIVE}\" WITH ALLOW_CONNECTIONS true" PSQL_FAIL_ONCE=1; then
  fail "a failed live re-open should exit 1"
fi
expect "$(marker "$LIVE")" night4 "the new database stays live"
expect "$(pg "SELECT datallowconn FROM pg_database WHERE datname = '$LIVE'")" t "recovery re-opened live"
expect "$(cat "$WORK/state/platform-tenant-id")" "$(pg "SELECT id FROM schools WHERE slug = 'default-school'" "$LIVE")" "state file written"
grep -q "redis.invalid:6379 FLUSHDB" "$LOG/redis.log" || fail "the live Redis db was not flushed"
[[ -e "$WORK/restarted" ]] || fail "app was not restarted"
grep -q "these steps failed: live-connections" "$WORK/err" || { cat "$WORK/err" >&2; fail "live-connections not reported"; }
grep -q "status=error" "$LOG/curl.log" || fail "error check-in missing"
pass "re-opening live fails: state file written, Redis flushed, app restarted, exit 1"

echo "reset.test.sh: all passed"
