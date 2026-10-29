#!/usr/bin/env bash
# Test for deploy/bin/biddaloy-staging. Pure bash: docker, flock and biddaloy-deploy are shims that
# append their arguments to $WORK/calls.log. No Docker, no network, no real VM.
#
#   bash deploy/bin/test/biddaloy-staging.test.sh
#
# Cases: 1 backups numbers 24 hourly + 14 daily and saves the list; 1b load <number> picks from the
# saved list, not a fresh one; 1c without a saved list a number is refused; 2 load picks by number (argument or stdin), runs
# the refresh into the scratch db (never biddaloy_staging), swaps it in, writes loaded-backup and a
# history line; 3 a failed refresh leaves the old db (no swap, no drop of biddaloy_staging), exit 1
# with a Next line; 4 load while staging is active stops the app only around the swap; 5 use
# staging refused when empty; 6 use staging migrates, flushes Redis, writes active-db, then deploys
# the current sha; a failed flush or deploy leaves active-db as it was; 7 clean-dev only ever
# touches biddaloy_staging_dev and refuses an argument; 8 nothing names prod; 9 locks come in
# order deploy then swap; 10 no --yes and no terminal is refused; 11 status prints the pieces.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../biddaloy-staging"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/opt/staging" "$WORK/opt/repo/deploy"
LOG="$WORK/calls.log"
: > "$LOG"
export WORK

cat > "$WORK/bin/docker" <<'SHIM'
#!/usr/bin/env bash
line="$*"
echo "docker $line" >> "$WORK/calls.log"
if [[ -n "${FAIL_MATCH:-}" && "$line" == *"$FAIL_MATCH"* ]]; then exit "${FAIL_RC:-1}"; fi
case "$line" in
  *"aws s3 ls"*) # the listing: the last argument is the prefix or the exact key
    case "$line" in
      *" db/hourly/") cat "$WORK/list-hourly" ;;
      *" db/daily/") cat "$WORK/list-daily" ;;
      *) grep -hF "${line##*/}" "$WORK/list-hourly" "$WORK/list-daily" | head -1 ;;
    esac ;;
  *"redis-cli FLUSHALL"*) echo OK ;;
  *"to_regclass"*) cat "$WORK/count" ;;
  *"SELECT 1"*) [[ -z "${NO_DEV:-}" ]] || exit 1 ;;
esac
exit 0
SHIM
cat > "$WORK/bin/flock" <<'SHIM'
#!/usr/bin/env bash
echo "flock $*" >> "$WORK/calls.log"
SHIM
cat > "$WORK/bin/biddaloy-deploy" <<'SHIM'
#!/usr/bin/env bash
echo "deploy $* (active-db=$(cat "$WORK/opt/staging/active-db"))" >> "$WORK/calls.log"
if [[ "${1:-}" == --last-ok ]]; then echo 0123456789abcdef0123456789abcdef01234567; exit 0; fi
[[ -z "${DEPLOY_FAIL:-}" ]]
SHIM
chmod +x "$WORK/bin/"*

# 30 hourly and 20 daily dumps: the list must cut them to 24 and 14.
: > "$WORK/list-hourly"; : > "$WORK/list-daily"
for i in $(seq 1 30); do printf '2026-10-%02d 10:00:00  1048576 2026-10-%02dT100000Z.dump.age\n' "$i" "$i" >> "$WORK/list-hourly"; done
for i in $(seq 1 20); do printf '2026-09-%02d 02:00:00  5242880 2026-09-%02d.dump.age\n' "$i" "$i" >> "$WORK/list-daily"; done
reset() { # reset [active]
  : > "$LOG"; : > "$WORK/opt/staging/history.log"; : > "$WORK/opt/staging/loaded-backup"
  echo "${1:-dev}" > "$WORK/opt/staging/active-db"; echo 5 > "$WORK/count"; rm -f "$WORK/out"
  local db=biddaloy_staging_dev b=sm-staging-dev
  if [[ "${1:-dev}" == staging ]]; then db=biddaloy_staging; b=sm-staging; fi
  printf 'POSTGRES_DB=%s\nPOSTGRES_USER=pg\nS3_BUCKET=%s\n' "$db" "$b" > "$WORK/opt/staging/.env"
}

PASS=0 FAILN=0
expect() { local name="$1"; shift; if "$@"; then PASS=$((PASS + 1)); echo "ok   $name"; else FAILN=$((FAILN + 1)); echo "FAIL $name"; fi; }
run() { # run <args...> -> RC and $WORK/out; stdin is $STDIN (default empty, not a terminal)
  RC=0
  env PATH="$WORK/bin:$PATH" BIDDALOY_ROOT="$WORK/opt" BIDDALOY_REPO="$WORK/opt/repo" BIDDALOY_SWAP_LOCK="$WORK/swap.lock" \
    BIDDALOY_DEPLOY_BIN="$WORK/bin/biddaloy-deploy" bash "$SCRIPT" "$@" > "$WORK/out" 2>&1 < "${STDIN:-/dev/null}" || RC=$?
}
has() { grep -qE -- "$1" "$LOG"; }
hasnt() { ! grep -qE -- "$1" "$LOG"; }
outhas() { grep -qE -- "$1" "$WORK/out"; }
hist_has() { grep -qE -- "$1" "$WORK/opt/staging/history.log"; }
line_of() { grep -nE -- "$1" "$LOG" | head -1 | cut -d: -f1; }
before() { local a b; a="$(line_of "$1")"; b="$(line_of "$2")"; [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]]; }
rows() { grep -cE '^ +[0-9]+  db/' "$WORK/out" || true; }

# 1 backups
reset
run backups
expect "1 backups exits 0" test "$RC" = 0
expect "1 24 hourly + 14 daily = 38 rows" test "$(rows)" = 38
expect "1 shows date and size" outhas '2026-09-20 02:00:00 5.0 MB'
expect "1 prints the next step" outhas 'Next: biddaloy-staging load'
expect "1 saves the printed list for load <number>" test "$(wc -l < "$WORK/opt/staging/backups-list" | tr -d ' ')" = 38

# 1b load <number> uses the saved list, not a fresh one: a dump that lands after `backups` must not
# shift the numbers (PR #3281 review). The newest hourly here is not in the saved list.
reset dev
cp "$WORK/list-hourly" "$WORK/list-hourly.keep"
printf '2026-10-31 10:00:00  1048576 2026-10-31T100000Z.dump.age\n' >> "$WORK/list-hourly"
run load 1 --yes
expect "1b exits 0" test "$RC" = 0
expect "1b loads the key the operator saw" has 'from db/hourly/2026-10-30T100000Z.dump.age'
expect "1b not the dump that landed later" hasnt 'from db/hourly/2026-10-31'
expect "1b no fresh listing of the prefixes" hasnt 'aws s3 ls.* db/hourly/$'
expect "1b says which backup it loads" outhas 'loading db/hourly/2026-10-30T100000Z.dump.age \(written 2026-10-30\)'
mv "$WORK/list-hourly.keep" "$WORK/list-hourly"
# 1c no saved list: a number is refused, nothing runs
reset dev
mv "$WORK/opt/staging/backups-list" "$WORK/backups-list.keep"
run load 1 --yes
expect "1c number without a saved list refused" test "$RC" = 2
expect "1c points at backups" outhas 'Next: run biddaloy-staging backups, then load <number>'
expect "1c nothing ran" hasnt 'staging-refresh'
mv "$WORK/backups-list.keep" "$WORK/opt/staging/backups-list"

# 2 load by number, dev active
reset dev
run load 1 --yes
expect "2 load exits 0" test "$RC" = 0
expect "2 refresh targets the scratch db" has 'staging-refresh.sh --target biddaloy_staging_drill --from db/hourly/2026-10-30'
expect "2 never refreshes biddaloy_staging directly" hasnt 'staging-refresh.sh --target biddaloy_staging --'
expect "2 swaps scratch in" has 'db-swap.sh biddaloy_staging biddaloy_staging_drill'
expect "2 app untouched while dev is active" hasnt 'stop app'
expect "2 loaded-backup written" grep -qx 2026-10-30 "$WORK/opt/staging/loaded-backup"
expect "2 history line" hist_has ' load db/hourly/.* ok$'
expect "2 active-db unchanged without --use" grep -qx dev "$WORK/opt/staging/active-db"

reset dev
printf '3\n' > "$WORK/pick"
STDIN="$WORK/pick" run load --yes
unset STDIN
expect "2b no argument prints the list" test "$RC" = 0 -a "$(rows)" = 38
expect "2b the typed number is loaded" has 'from db/hourly/2026-10-28'
reset dev
run load 99 --yes
expect "2c number out of range refused" test "$RC" = 2
expect "2c nothing ran" hasnt 'staging-refresh'
run load db/hourly/..%2f.dump.age --yes
expect "2d bad key refused" test "$RC" = 2

# 2e load --use ends with use staging: active-db staging, then the current sha deployed
reset dev
run load latest-daily --use --yes
expect "2e load --use exits 0" test "$RC" = 0
expect "2e latest-daily resolves to the newest daily key" has 'from db/daily/2026-09-20.dump.age'
expect "2e deploy ran after active-db became staging" has '^deploy staging 0123456789abcdef0123456789abcdef01234567 \(active-db=staging\)'

# 3 a failed refresh leaves the old db
reset dev
FAIL_MATCH='staging-refresh.sh' run load 2 --yes
expect "3 failed refresh exits 1" test "$RC" = 1
expect "3 no swap" hasnt 'db-swap.sh'
expect "3 biddaloy_staging never dropped" hasnt 'DROP DATABASE[^;]*"biddaloy_staging"'
expect "3 prints Next" outhas 'Next: nothing changed'
expect "3 history failed line" hist_has ' load db/.* failed:refresh$'
expect "3 loaded-backup unchanged" test ! -s "$WORK/opt/staging/loaded-backup"

# 4 load while staging is active: the app stops only after the refresh, around the swap
reset staging
run load 1 --yes
expect "4 exits 0" test "$RC" = 0
expect "4 refresh before stop" before 'staging-refresh' 'stop app'
expect "4 stop before swap" before 'stop app' 'db-swap.sh biddaloy_staging biddaloy_staging_drill'
expect "4 swap before migrate" before 'db-swap.sh biddaloy_staging biddaloy_staging_drill' 'migrate.js run'
expect "4 migrate before deploy" before 'migrate.js run' '^deploy staging'
expect "4 redis flushed" has 'redis-cli FLUSHALL'
reset staging
FAIL_MATCH='db-swap.sh biddaloy_staging biddaloy_staging_drill' run load 1 --yes
expect "4b failed swap exits 1 and restarts the app" test "$RC" = 1 -a "$(grep -c 'start app' "$LOG")" = 1
expect "4b says the old db is kept" outhas 'is the old one'

# 4c active-db and .env disagree (a switch did not finish): every mutating verb refuses, nothing runs
reset dev
echo staging > "$WORK/opt/staging/active-db"
for v in "clean-dev --yes" "use dev --yes" "load 1 --yes"; do
  run $v
  expect "4c $v refused" test "$RC" = 2
  expect "4c $v points at biddaloy-deploy" outhas 'Next: biddaloy-deploy staging'
done
expect "4c nothing destructive ran" hasnt 'DROP DATABASE|recursive=true|db-swap|staging-refresh'
# 4d load while staging is active ends with a deploy (fresh badge date), not a bare start
reset staging
run load 1 --yes
expect "4d load deploys the last ok sha after migrate and flush" before 'FLUSHALL' '^deploy staging 0123'
reset staging
FAIL_MATCH='redis-cli FLUSHALL' run load 1 --yes
expect "4d failed flush Next is biddaloy-deploy" outhas 'Next: the app is stopped: check docker compose -p staging logs redis, then biddaloy-deploy staging'

# 5 use staging refused when empty
reset dev
echo 0 > "$WORK/count"
run use staging --yes
expect "5 refused when empty" test "$RC" = 2
expect "5 says load a backup first" outhas 'load a backup first'
expect "5 nothing deployed" hasnt '^deploy staging'
expect "5 active-db unchanged" grep -qx dev "$WORK/opt/staging/active-db"

# 6 use staging
reset dev
run use staging --yes
expect "6 use staging exits 0" test "$RC" = 0
expect "6 migrates the target first" has 'migrate.js run'
expect "6 migrate before flush" before 'migrate.js run' 'FLUSHALL'
expect "6 flush before deploy" before 'FLUSHALL' '^deploy staging'
expect "6 active-db written" grep -qx staging "$WORK/opt/staging/active-db"
expect "6 history line" hist_has ' use staging ok$'
reset dev
FAIL_MATCH='redis-cli FLUSHALL' run use staging --yes
expect "6b failed flush aborts with exit 1" test "$RC" = 1
expect "6b active-db unchanged" grep -qx dev "$WORK/opt/staging/active-db"
expect "6b app started again" has 'start app'
expect "6b no deploy" hasnt '^deploy staging'
reset dev
DEPLOY_FAIL=1 run use staging --yes
expect "6c failed deploy exits 1" test "$RC" = 1
expect "6c active-db put back" grep -qx dev "$WORK/opt/staging/active-db"
expect "6c prints Next" outhas 'Next: active-db was put back to dev'
reset staging
run use staging --yes
expect "6d already active is a no-op" test "$RC" = 0
expect "6d no deploy" hasnt '^deploy staging'
reset staging
NO_DEV=1 run use dev --yes
expect "6e use dev refused when the dev db is missing" test "$RC" = 2
expect "6e points at clean-dev" outhas 'clean-dev'

# 7 clean-dev
reset dev
run clean-dev --yes
expect "7 clean-dev exits 0" test "$RC" = 0
expect "7 app stopped and started (dev is active)" test "$(grep -cE 'stop app|start app' "$LOG")" = 2
expect "7 drops the dev db" has 'DROP DATABASE IF EXISTS "biddaloy_staging_dev"'
expect "7 drops nothing else" test "$(grep -cE 'DROP DATABASE' "$LOG")" = 1
expect "7 empties the dev bucket" has 'buckets/sm-staging-dev/\?recursive=true'
expect "7 migrates dev" has 'migrate.js run'
expect "7 history line" hist_has ' clean-dev biddaloy_staging_dev ok$'
reset staging
run clean-dev --yes
expect "7b staging active: app untouched" hasnt 'stop app'
expect "7b only the -dev bucket is emptied" has 'buckets/sm-staging-dev/\?recursive=true'
run clean-dev staging --yes
expect "7c refuses an argument" test "$RC" = 2
expect "7c says what it does" outhas 'only cleans dev'

# 8 nothing can target prod
reset dev
run use staging --yes
expect "8 no call uses the prod stack or db" hasnt '(-p prod|biddaloy_prod|-d biddaloy( |$))'
printf 'POSTGRES_DB=biddaloy\nPOSTGRES_USER=pg\n' > "$WORK/opt/staging/.env"
: > "$LOG"
run clean-dev --yes
expect "8 a .env that names the prod db is refused" test "$RC" = 2
expect "8 no docker call was made" test "$(grep -c docker "$LOG")" = 0

# 9 lock order
reset dev
run use staging --yes
expect "9 two locks, deploy.lock first" test "$(grep -c '^flock' "$LOG")" = 2
expect "9 the first lock is on fd 8 (deploy.lock), the second on fd 9" bash -c "grep '^flock' '$LOG' | sed -n 1p | grep -q ' 8\$' && grep '^flock' '$LOG' | sed -n 2p | grep -q ' 9\$'"

# 10 no --yes without a terminal
reset dev
run use staging
expect "10 refused without --yes" test "$RC" = 2
expect "10 asks for --yes" outhas '--yes'
expect "10 nothing ran" test "$(grep -c . "$LOG")" = 0
run bogus
expect "10b unknown verb refused with usage" test "$RC" = 2
expect "10b usage printed" outhas 'status \| backups'

# 11 status
reset staging
echo 2026-10-27 > "$WORK/opt/staging/loaded-backup"
echo "2026-10-29T02:25:00+0600 duration=300s schools=3 users=9 students=40" > "$WORK/opt/staging/last-drill"
echo "2026-10-28T10:00:00Z me load db/daily/x ok" > "$WORK/opt/staging/history.log"
run status
expect "11 status exits 0" test "$RC" = 0
expect "11 active db" outhas 'active db:     staging'
expect "11 loaded backup" outhas '2026-10-27'
expect "11 sha" outhas '0123456789abcdef'
expect "11 last drill" outhas 'schools=3'
expect "11 history" outhas 'me load db/daily/x ok'
: > "$WORK/opt/staging/last-drill" # provision creates it empty
run status
expect "11 empty last-drill is none yet" outhas 'last drill:    none yet'

# 12 --from-github: anchored forms only; mutating verbs run detached and the log is streamed
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\n[[ "${1:-}" == --wait ]] && shift\nexec "$@"\n' > "$WORK/bin/setsid"
chmod +x "$WORK/bin/setsid"
mkdir -p "$WORK/opt/logs"
gh() { RC=0; env SSH_ORIGINAL_COMMAND="$1" PATH="$WORK/bin:$PATH" BIDDALOY_ROOT="$WORK/opt" BIDDALOY_REPO="$WORK/opt/repo" \
  BIDDALOY_SWAP_LOCK="$WORK/swap.lock" BIDDALOY_DEPLOY_BIN="$WORK/bin/biddaloy-deploy" bash "$SCRIPT" --from-github > "$WORK/out" 2>&1 < /dev/null || RC=$?; }
reset dev
gh "status"; expect "12 status allowed" test "$RC" = 0
printf 'db/daily/2026-09-01.dump.age 2026-09-01 02:00:00 5.0 MB\n' > "$WORK/opt/staging/backups-list"
gh "backups"; expect "12 backups allowed" test "$RC" = 0
expect "12 GitHub backups keeps the operator's saved list" test "$(cat "$WORK/opt/staging/backups-list")" = 'db/daily/2026-09-01.dump.age 2026-09-01 02:00:00 5.0 MB'
gh "load db/daily/2026-09-20.dump.age --yes --use"
expect "12 load key --yes --use runs" test "$RC" = 0
expect "12 it refreshed that key" has 'from db/daily/2026-09-20.dump.age'
expect "12 and deployed (use)" has '^deploy staging'
expect "12 output was streamed from the log" outhas 'step: refresh'
expect "12 log kept on the VM" test -s "$WORK/opt/logs/staging-last.log"
reset dev
gh "use staging --yes"; expect "12 use staging --yes allowed" test "$RC" = 0
reset dev
gh "clean-dev --yes"; expect "12 clean-dev --yes allowed" test "$RC" = 0
# The exact strings .github/workflows/staging.yml sends (its case on ACTION). Not prefixed with the
# command name: the forced command is already biddaloy-staging.
reset dev; gh "use dev --yes"; expect "12 workflow: use dev --yes allowed" test "$RC" = 0
reset dev; gh "load latest-daily --yes"; expect "12 workflow: load latest-daily --yes allowed" test "$RC" = 0
reset dev; gh "load latest-hourly --yes --use"; expect "12 workflow: load latest-hourly --yes --use allowed" test "$RC" = 0
for bad in "biddaloy-staging status" "biddaloy-staging load latest-daily --yes" "--from-github" \
  "load db/daily/x.dump.age" "load ../x --yes" "load a//b --yes" "load a..b --yes" "load 3 --yes" "load -x --yes" \
  "load $(printf 'a%.0s' $(seq 1 201)) --yes" "use prod --yes" "use staging" "clean-dev" "status; id" "status
id" "load db/daily/x --yes --use extra" "" "rm -rf /"; do
  reset dev; : > "$LOG"
  gh "$bad"
  expect "12 refused: $(printf '%s' "$bad" | head -c 30 | tr '\n' ' ')" test "$RC" = 2 -a "$(grep -c . "$LOG")" = 0
done

echo "$PASS passed, $FAILN failed"
[[ $FAILN -eq 0 ]]
