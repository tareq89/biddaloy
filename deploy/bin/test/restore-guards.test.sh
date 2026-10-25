#!/usr/bin/env bash
# Tests scripts/backup/restore.sh guards with psql, pg_restore and age as PATH shims. No Docker.
#   bash deploy/bin/test/restore-guards.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RESTORE="$HERE/../../../scripts/backup/restore.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
LOG="$WORK/calls.log"

cat > "$WORK/bin/psql" <<'SHIM'
#!/usr/bin/env bash
echo "psql $*" >> "$WORK/calls.log"
case " $* " in
  *" -1 "*) cat > "$WORK/stdin.sql"
            if [[ -n "${TXN_REFUSE:-}" ]]; then echo "ERROR:  restore-refused-not-empty" >&2; exit 3; fi
            exit "${TXN_RC:-0}" ;;
  *" -c "*) echo "${COUNT:-0}" ;;
esac
SHIM
cat > "$WORK/bin/pg_restore" <<'SHIM'
#!/usr/bin/env bash
echo "pg_restore $*" >> "$WORK/calls.log"
[[ -z "${PGR_FAIL:-}" ]] || exit 1
while [[ $# -gt 0 ]]; do if [[ "$1" == -f ]]; then echo "CREATE TABLE dumped();" > "$2"; fi; shift; done
SHIM
cat > "$WORK/bin/age" <<'SHIM'
#!/usr/bin/env bash
echo "age" >> "$WORK/calls.log"
while [[ $# -gt 0 ]]; do if [[ "$1" == -o ]]; then echo dump > "$2"; fi; shift; done
SHIM
chmod +x "$WORK/bin/"*
echo enc > "$WORK/a.dump.age"
export PATH="$WORK/bin:$PATH" WORK BACKUP_AGE_PRIVATE_KEY_FILE=/nonexistent
LIVE='postgres://u:p@db:5432/biddaloy_prod?sslmode=require'

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
expect() { if "${@:2}"; then ok "$1"; else bad "$1"; fi; }
RC=0
run() { : > "$LOG"; rm -f "$WORK/stdin.sql"; RC=0; "$RESTORE" "$@" >"$WORK/out.txt" 2>&1 || RC=$?; }

export DATABASE_URL="$LIVE"
run "$WORK/a.dump.age" "$LIVE"
expect "live target without flags -> exit 1" test "$RC" -eq 1
run "$WORK/a.dump.age" @env --allow-live-target
expect "--allow-live-target alone -> exit 1" test "$RC" -eq 1
run "$WORK/a.dump.age" @env --allow-live-target --require-empty
expect "--allow-live-target without --expect-db -> exit 1" test "$RC" -eq 1
run "$WORK/a.dump.age" @env --allow-live-target --expect-db biddaloy_prod
expect "--allow-live-target without --require-empty -> exit 1" test "$RC" -eq 1
expect "refusals ran nothing" test ! -s "$LOG"
run "$WORK/a.dump.age" @env --allow-live-target --require-empty --expect-db biddaloy_other
expect "--expect-db mismatch -> exit 1, nothing run" bash -c "[[ $RC -eq 1 && ! -s '$LOG' ]]"

COUNT=2 run "$WORK/a.dump.age" @env --allow-live-target --require-empty --expect-db biddaloy_prod
expect "non-empty -> exit 3" test "$RC" -eq 3
expect "non-empty: refused before decrypt and pg_restore" bash -c "! grep -qE '^(age|pg_restore)' '$LOG'"

run "$WORK/a.dump.age" @env --allow-live-target --require-empty --expect-db biddaloy_prod
expect "empty -> exit 0" test "$RC" -eq 0
expect "restore is one psql -1 transaction" grep -q "psql -1 -q" "$LOG"
expect "pg_restore has no --clean" bash -c "! grep '^pg_restore' '$LOG' | grep -q -e --clean"
expect "transaction order: guard, DROP SCHEMA, CREATE SCHEMA, dump" bash -c "
  g=\$(grep -n restore-refused-not-empty '$WORK/stdin.sql' | head -1 | cut -d: -f1)
  d=\$(grep -n 'DROP SCHEMA public CASCADE' '$WORK/stdin.sql' | cut -d: -f1)
  c=\$(grep -n 'CREATE SCHEMA public' '$WORK/stdin.sql' | cut -d: -f1)
  t=\$(grep -n 'CREATE TABLE dumped' '$WORK/stdin.sql' | cut -d: -f1)
  [[ \$g -lt \$d && \$d -lt \$c && \$c -lt \$t ]]"
expect "the guard ignores default-school" grep -q "default-school" "$WORK/stdin.sql"
expect "migrations are not run (message)" grep -q "migrations NOT run" "$WORK/out.txt"

TXN_REFUSE=1 run "$WORK/a.dump.age" @env --allow-live-target --require-empty --expect-db biddaloy_prod
expect "data appears inside the transaction -> exit 3" test "$RC" -eq 3
TXN_RC=1 run "$WORK/a.dump.age" @env --allow-live-target --require-empty --expect-db biddaloy_prod
expect "transaction failure -> exit 1, says rolled back" bash -c "[[ $RC -eq 1 ]] && grep -q 'rolled back' '$WORK/out.txt'"
PGR_FAIL=1 run "$WORK/a.dump.age" @env --allow-live-target --require-empty --expect-db biddaloy_prod
expect "pg_restore failure -> exit 1, psql never gets a half script" bash -c "[[ $RC -eq 1 ]] && ! grep -q 'psql -1' '$LOG'"

# the staging refresh path: an empty _next DB, no --require-empty, old behaviour
run "$WORK/a.dump.age" "postgres://u:p@db:5432/biddaloy_staging_next" --no-migrate
expect "staging path still uses pg_restore --clean --if-exists -d" grep -q "pg_restore --clean --if-exists --no-owner -d" "$LOG"

echo
if [[ $fails -eq 0 ]]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
