#!/usr/bin/env bash
# Test for db-swap.sh against a real Postgres: the swap, the previous-database chain, the guards
# that keep it away from production, and the rollback when a rename fails half way.
#
#   bash scripts/backup/db-swap.infra.test.sh
#
# Same setup as scripts/demo/reset.infra.test.sh: it uses the shared stack's running db container
# when there is one, otherwise starts a throwaway Postgres from the image docker-compose.yml pins
# and removes it on exit. It only ever creates, renames and drops databases named
# biddaloy_staging_t<pid>*; the guard cases get a psql that always fails, so a broken guard cannot
# reach any real database.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SWAP="$HERE/db-swap.sh"
DB_CONTAINER="$(docker ps -q --filter label=com.docker.compose.project=biddaloy \
  --filter label=com.docker.compose.service=db | head -1)"
OWN_DB=""
if [[ -z "$DB_CONTAINER" ]]; then
  PG_IMAGE="$(sed -n 's/^ *image: \(postgres:.*\)$/\1/p' "$HERE/../../docker-compose.yml" | head -1)"
  [[ -n "$PG_IMAGE" ]] || { echo "db-swap.infra.test.sh: no postgres image in docker-compose.yml" >&2; exit 1; }
  OWN_DB="db-swap-infra-test-pg-$$"
  docker run -d --rm --name "$OWN_DB" -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo "$PG_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$OWN_DB" pg_isready -q -h 127.0.0.1 -U demo 2>/dev/null && break
    sleep 1
  done
  docker exec "$OWN_DB" pg_isready -q -h 127.0.0.1 -U demo || { echo "db-swap.infra.test.sh: Postgres did not start" >&2; exit 1; }
  DB_CONTAINER="$OWN_DB"
fi
ENV_OF_DB="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER")"
PG_USER="$(sed -n 's/^POSTGRES_USER=//p' <<<"$ENV_OF_DB")"
PG_PASS="$(sed -n 's/^POSTGRES_PASSWORD=//p' <<<"$ENV_OF_DB")"

WORK="$(mktemp -d)"
mkdir -p "$WORK/bin"
# psql runs inside the db container; psql-forbidden fails and records that it was called.
cat > "$WORK/bin/psql" <<EOF
#!/usr/bin/env bash
exec docker exec -i "$DB_CONTAINER" psql "\$@"
EOF
cat > "$WORK/bin/psql-forbidden" <<EOF
#!/usr/bin/env bash
echo called >> "$WORK/forbidden.log"
exit 97
EOF
# macOS has no flock(1); the image has it. Stand-in for `flock -n FD`.
if ! command -v flock >/dev/null; then
  cat > "$WORK/bin/flock" <<'EOF'
#!/usr/bin/perl
use Fcntl ':flock';
open(my $fh, '>&=', $ARGV[-1]) or exit 1;
flock($fh, LOCK_EX | LOCK_NB) or exit 1;
EOF
fi
chmod +x "$WORK/bin/"*

TAG="t$$"
LIVE="biddaloy_staging_${TAG}"
NEXT="${LIVE}_next"
BASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:5432"

pg() { docker exec -i "$DB_CONTAINER" psql -U "$PG_USER" -d "${2:-postgres}" -v ON_ERROR_STOP=1 -tAqc "$1"; }
db_exists() { [[ "$(pg "SELECT 1 FROM pg_database WHERE datname = '$1'")" == 1 ]]; }
marker() { pg "SELECT v FROM marker" "$1"; }
allows() { pg "SELECT datallowconn FROM pg_database WHERE datname = '$1'"; }
make_db() { # $1 name, $2 marker
  pg "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)"
  pg "CREATE DATABASE \"$1\""
  pg "CREATE TABLE marker(v text); INSERT INTO marker VALUES ('$2')" "$1"
}
cleanup() {
  local d
  for d in "$LIVE" "$NEXT" "${LIVE}_prev" "${LIVE}_prev_old"; do
    pg "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK" "/tmp/db-swap-${LIVE}.lock"
  [[ -z "$OWN_DB" ]] || docker rm -f "$OWN_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; cat "$WORK/out" "$WORK/err" >&2 2>/dev/null || true; exit 1; }
expect() { [[ "$1" == "$2" ]] || fail "$3 (expected '$2', got '$1')"; }
swap() { env -i PATH="$WORK/bin:$PATH" HOME="$HOME" DATABASE_URL="$BASE_URL/$LIVE" "$@" > "$WORK/out" 2> "$WORK/err"; }

# ---- 1. swap: next becomes live, live is kept as _prev ----------------------------------------
make_db "$LIVE" old
make_db "$NEXT" new1
swap bash "$SWAP" "$LIVE" "$NEXT" || fail "good swap exited non-zero"
expect "$(cat "$WORK/out")" "swap ok: ${LIVE} (was ${NEXT}), previous kept as ${LIVE}_prev" "success line"
expect "$(marker "$LIVE")" new1 "live holds the new database"
expect "$(marker "${LIVE}_prev")" old "the old live is kept as _prev"
db_exists "$NEXT" && fail "_next should be gone"
expect "$(allows "$LIVE")" t "live accepts connections"
expect "$(allows "${LIVE}_prev")" t "_prev accepts connections"
pass "swap: next -> live, live -> _prev, both open"

# ---- 2. the chain: _prev -> _prev_old, then --drop-prev-old ----------------------------------
make_db "$NEXT" new2
swap bash "$SWAP" "$LIVE" "$NEXT" || fail "second swap failed"
expect "$(marker "$LIVE")" new2 "second swap is live"
expect "$(marker "${LIVE}_prev")" new1 "_prev is the first swap"
expect "$(marker "${LIVE}_prev_old")" old "_prev_old is the original"
make_db "$NEXT" new3
if swap bash "$SWAP" "$LIVE" "$NEXT"; then fail "a swap onto an existing _prev_old must fail"; fi
# Refused by the pre-check, before any rename.
grep -q "swap FAILED at check-next: .*_prev_old still exists" "$WORK/err" || fail "FAILED at <step> line missing"
expect "$(marker "$LIVE")" new2 "live untouched by the refused swap"
expect "$(marker "${LIVE}_prev")" new1 "_prev untouched by the refused swap"
expect "$(marker "${LIVE}_prev_old")" old "_prev_old untouched by the refused swap"
expect "$(marker "$NEXT")" new3 "_next untouched by the refused swap"
swap bash "$SWAP" --drop-prev-old "$LIVE" || fail "--drop-prev-old failed"
db_exists "${LIVE}_prev_old" && fail "_prev_old should be dropped"
swap bash "$SWAP" "$LIVE" "$NEXT" || fail "swap after --drop-prev-old failed"
expect "$(marker "$LIVE")" new3 "third swap is live"
pass "previous-database chain and --drop-prev-old"

# ---- 3. guards: only staging / demo names, never prod ------------------------------------------
forbid() { # runs db-swap.sh with a psql that must never be called; expects exit 2 and a message
  local what="$1" msg="$2"; shift 2
  mkdir -p "$WORK/forbid-bin"; cp "$WORK/bin/psql-forbidden" "$WORK/forbid-bin/psql"; cp "$WORK/bin/flock" "$WORK/forbid-bin/flock" 2>/dev/null || true
  : > "$WORK/forbidden.log"
  local rc=0
  env -i PATH="$WORK/forbid-bin:$PATH" HOME="$HOME" DATABASE_URL="$BASE_URL/$LIVE" bash "$SWAP" "$@" > "$WORK/out" 2> "$WORK/err" || rc=$?
  [[ "$rc" == 2 ]] || fail "$what: expected exit 2, got $rc"
  grep -q "$msg" "$WORK/err" || fail "$what: wrong message"
  [[ ! -s "$WORK/forbidden.log" ]] || fail "$what: psql was called before the refusal"
  pass "refuses: $what"
}
forbid "the production database" "refusing to touch database 'biddaloy'" biddaloy biddaloy_next
forbid "production as the next name" "refusing to touch database 'biddaloy'" "$LIVE" biddaloy
forbid "the maintenance database" "refusing to touch database 'postgres'" postgres "$NEXT"
forbid "a name without staging or demo" "refusing to touch database 'biddaloy_prod'" biddaloy_prod biddaloy_prod_next
forbid "a name with SQL in it" "refusing to touch database" 'biddaloy_demo"; DROP DATABASE biddaloy; --' biddaloy_demo_next
forbid "a demo/staging mix" "both be demo or both be staging" biddaloy_demo biddaloy_staging_next
forbid "live equals next" "same database" "$LIVE" "$LIVE"
forbid "--drop-prev-old on production" "refusing to touch database 'biddaloy'" --drop-prev-old biddaloy
forbid "a live name ending in _prev" "ends in _next, _prev or _prev_old" "${LIVE}_prev" "$NEXT"
forbid "a live name ending in _next" "ends in _next, _prev or _prev_old" "${LIVE}_next" "$NEXT"
forbid "next is the live's _prev_old" "its _prev_old" "$LIVE" "${LIVE}_prev_old"
forbid "no arguments" "usage:"

# ---- 4. a rename that fails half way rolls back and leaves live intact -------------------------
# An open session on _next makes `RENAME next -> live` fail after live was already moved to _prev.
swap bash "$SWAP" --drop-prev-old "$LIVE" || fail "--drop-prev-old before the failure case failed"
make_db "$NEXT" new4
docker exec "$DB_CONTAINER" psql -U "$PG_USER" -d "$NEXT" -qc "SELECT pg_sleep(120)" >/dev/null 2>&1 &
SLEEPER=$!
for _ in $(seq 1 20); do
  [[ "$(pg "SELECT count(*) FROM pg_stat_activity WHERE datname = '$NEXT' AND query LIKE '%pg_sleep%'")" == 1 ]] && break
  sleep 0.5
done
if swap bash "$SWAP" "$LIVE" "$NEXT"; then kill "$SLEEPER" 2>/dev/null || true; fail "a swap with a blocked rename must fail"; fi
grep -q "swap FAILED at next-to-live: " "$WORK/err" || fail "FAILED at next-to-live missing"
grep -q "rolled back: the previous database is ${LIVE} again" "$WORK/err" || fail "rollback not logged"
expect "$(marker "$LIVE")" new3 "live is intact after the failed swap"
expect "$(marker "${LIVE}_prev")" new2 "_prev is what it was before the failed swap"
expect "$(allows "$LIVE")" t "live accepts connections after the rollback"
expect "$(allows "$NEXT")" t "_next accepts connections after the rollback"
kill "$SLEEPER" 2>/dev/null || true; wait "$SLEEPER" 2>/dev/null || true
pass "forced mid-swap failure: recover() puts the old live back, connections re-opened"

# ---- 4b. swap back: next == _prev makes _prev live and the old live becomes _prev ---------------
swap bash "$SWAP" --drop-prev-old "$LIVE" || fail "--drop-prev-old failed"
before_live="$(marker "$LIVE")"; before_prev="$(marker "${LIVE}_prev")"
swap bash "$SWAP" "$LIVE" "${LIVE}_prev" || fail "swap back exited non-zero"
expect "$(cat "$WORK/out")" "swap ok: ${LIVE} (was ${LIVE}_prev), previous kept as ${LIVE}_prev" "swap-back success line"
expect "$(marker "$LIVE")" "$before_prev" "the old _prev is live again"
expect "$(marker "${LIVE}_prev")" "$before_live" "the old live is _prev"
db_exists "${LIVE}_swap" && fail "the temporary ${LIVE}_swap must be gone"
db_exists "${LIVE}_prev_old" && fail "swap back must not create _prev_old"
expect "$(allows "$LIVE")" t "live accepts connections after swap back"
expect "$(allows "${LIVE}_prev")" t "_prev accepts connections after swap back"
swap bash "$SWAP" "$LIVE" "${LIVE}_prev" || fail "swapping back again (forward) failed"
expect "$(marker "$LIVE")" "$before_live" "a second swap-back restores the original order"
pass "swap back (next == _prev) keeps the chain intact"

# ---- 4c. a first swap with no previous live database says so, and keeps a failed chain whole ---
pg "DROP DATABASE IF EXISTS \"${LIVE}_prev\" WITH (FORCE)"
pg "DROP DATABASE IF EXISTS \"$LIVE\" WITH (FORCE)"
make_db "$NEXT" first
swap bash "$SWAP" "$LIVE" "$NEXT" || fail "first swap (no live) failed"
expect "$(cat "$WORK/out")" "swap ok: ${LIVE} (was ${NEXT}), there was no previous live database" "first-swap line"
expect "$(marker "$LIVE")" first "live holds the first database"
db_exists "${LIVE}_prev" && fail "no _prev should exist after a first swap"
pass "first swap without a live database"

# ---- 5. only one swap per live name at a time --------------------------------------------------
exec 8>"/tmp/db-swap-${LIVE}.lock"
PATH="$WORK/bin:$PATH" flock -n 8 || fail "test could not take the lock"
if swap bash "$SWAP" "$LIVE" "$NEXT"; then exec 8>&-; fail "a concurrent swap must be refused"; fi
exec 8>&-
grep -q "another swap of ${LIVE} is running" "$WORK/err" || fail "lock refusal message missing"
expect "$(marker "$LIVE")" first "live untouched by a refused concurrent swap"
pass "a second swap while the lock is held is refused"

echo "db-swap.infra.test.sh: all passed"
