#!/usr/bin/env bash
# Test for deploy/bin/biddaloy-restore-prod. Pure bash: docker and flock are PATH shims that
# append their arguments to $WORK/calls.log. No Docker, no network.
#
#   bash deploy/bin/test/biddaloy-restore-prod.test.sh
#
# Cases: 1 happy path runs the steps in order, locks first, logs ok; 2 a non-empty prod DB exits 2
# before anything is stopped or restored; 3 a confirmation that is not the .env DB name, or missing,
# exits 2 with no docker call; 4 a key file that is group/world readable, a symlink or missing is
# refused; 5 --from must be an explicit key or latest-*, and the printed backup age appears;
# 6 restore.sh exit 3 exits 2 and never copies files or migrates; 7 restore.sh failure exits 1
# with the FAILED block and no files/migrate; 8 files failure is a warning; 9 a restored DB with no
# school fails verify; 10 no secret reaches a shim's arguments; 11 every compose call carries the
# project directory and file; 13 latest-* skips the dumps this VM wrote itself; 14 the compose file
# kept by prod's last ok deploy wins.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../biddaloy-restore-prod"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/opt/prod" "$WORK/opt/repo" "$WORK/k" "$WORK/kopen" "$WORK/klink" "$WORK/kextra"
LOG="$WORK/calls.log"

# docker: FAIL_MATCH = substring of the argument line that makes the call exit FAIL_RC (default 1).
# The database check (psql) answers $COUNTS_BEFORE first and $COUNTS_AFTER once restore.sh ran.
cat > "$WORK/bin/docker" <<'SHIM'
#!/usr/bin/env bash
line="$*"
echo "docker $line" >> "$WORK/calls.log"
if [[ -n "${FAIL_MATCH:-}" && "$line" == *"$FAIL_MATCH"* ]]; then exit "${FAIL_RC:-1}"; fi
case "$line" in
  *"psql -U"*)
    if grep -q "restore.sh" "$WORK/calls.log"; then echo "${COUNTS_AFTER}"; else echo "${COUNTS_BEFORE}"; fi ;;
  *"aws s3 ls"*) printf '%s\n' "${LISTING}" ;;
  *"volume inspect"*) echo "${VOL_CREATED}" ;;
  *"migrate.js pending"*) exit "${PENDING_RC:-2}" ;;
esac
exit 0
SHIM
cat > "$WORK/bin/flock" <<'SHIM'
#!/usr/bin/env bash
echo "flock $*" >> "$WORK/calls.log"
[[ -z "${FLOCK_FAIL:-}" ]]
SHIM
chmod +x "$WORK/bin/"*

SECRET_PW='sup3r-secret-pw'
DB=biddaloy_prod
printf 'POSTGRES_DB=%s\nPOSTGRES_USER=bid\nPOSTGRES_PASSWORD=%s\n' "$DB" "$SECRET_PW" > "$WORK/opt/prod/.env"
# Each bad key sits in its own directory: the script refuses a key directory that holds anything else.
printf 'AGE-SECRET-KEY-1TESTKEYCONTENT\n' > "$WORK/k/key.txt"; chmod 600 "$WORK/k/key.txt"
printf 'x\n' > "$WORK/kopen/key.txt"; chmod 640 "$WORK/kopen/key.txt"
ln -s "$WORK/k/key.txt" "$WORK/klink/key.txt"
printf 'x\n' > "$WORK/kextra/key.txt"; chmod 600 "$WORK/kextra/key.txt"; echo y > "$WORK/kextra/other"

NOW_H="$(date -u -d '2 hours ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u -v-2H '+%Y-%m-%d %H:%M:%S')"
OLD_TS="$(date -u -d '30 hours ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u -v-30H '+%Y-%m-%d %H:%M:%S')"
VERY_OLD_TS="$(date -u -d '50 hours ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u -v-50H '+%Y-%m-%d %H:%M:%S')"
OLD_LINE="${OLD_TS}      9000 20261021T100000Z.dump.age"
VERY_OLD_LINE="${VERY_OLD_TS}      9000 20261020T100000Z.dump.age"
NEW_LINE="${NOW_H}      9100 20261022T120000Z.dump.age"
export LISTING="$VERY_OLD_LINE
$OLD_LINE
$NEW_LINE"
RESTORE_KEY_UID="$(id -u)"
export RESTORE_KEY_UID
export PATH="$WORK/bin:$PATH" WORK
export BIDDALOY_ROOT="$WORK/opt" BIDDALOY_REPO="$WORK/opt/repo" BIDDALOY_SWAP_LOCK="$WORK/swap.lock"
export COUNTS_BEFORE="0|0|$DB" COUNTS_AFTER="3|12|$DB"
# When this VM's prod_pgdata volume was made (docker's CreatedAt). Default: now, so every dump is older.
VOL_CREATED="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
VOL_10H="$(date -u -d '10 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-10H '+%Y-%m-%dT%H:%M:%SZ')"
export VOL_CREATED

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
expect() { if "${@:2}"; then ok "$1"; else bad "$1"; fi; }
has() { grep -qF -- "$1" "$LOG"; }
hasnt() { ! has "$1"; }
at() { grep -nF -- "$1" "$LOG" | head -1 | cut -d: -f1; }
before() { local a b; a="$(at "$1")"; b="$(at "$2")"; [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]]; }

RC=0
run() { : > "$LOG"; : > "$WORK/out.txt"; RC=0; "$SCRIPT" "$@" > "$WORK/out.txt" 2>&1 || RC=$?; }
outhas() { grep -qF -- "$1" "$WORK/out.txt"; }
good=(--age-key-file "$WORK/k/key.txt" --from latest-hourly --yes-restore-prod "$DB")

# 1. happy path
: > "$WORK/opt/prod/deploys.log"
run "${good[@]}"
expect "1 happy path exits 0" test "$RC" -eq 0
expect "1 order: lock, check, list, stop, restore, files, migrate, verify" bash -c "
  $(declare -f at before); LOG='$LOG'
  before 'flock' 'psql -U' && before 'psql -U' 'aws s3 ls' && before 'aws s3 ls' 'compose -p prod --project-directory $WORK/opt/prod -f $WORK/opt/repo/deploy/stack.yml stop app app2 backup' && before ' stop app' 'restore.sh' && before 'restore.sh' 'rclone copy' && before 'rclone copy' 'migrate.js pending' && before 'migrate.js pending' 'migrate.js run'"
expect "1 deploy lock taken before swap lock" before "flock -w 3600 8" "flock -w 3600 9"
expect "1 restore.sh gets the guards" has "restore.sh db/hourly/20261022T120000Z.dump.age @env --no-migrate --require-empty --allow-live-target --expect-db $DB"
expect "1 newest key picked, not the older one" hasnt "20261021T100000Z"
expect "1 prints the backup age" outhas "(2 hours old)"
expect "1 prints the next command" outhas "biddaloy-deploy prod <sha>"
expect "1 the app is never started" hasnt " up "
expect "1 deploys.log ok line" grep -q "prod restore db/hourly/20261022T120000Z.dump.age ok" "$WORK/opt/prod/deploys.log"
expect "1 key dir mounted via env, key file name in -e" has "BACKUP_AGE_PRIVATE_KEY_FILE=/run/age/key.txt"

# 2. non-empty DB
for c in "1|0|$DB" "0|4|$DB"; do
  COUNTS_BEFORE="$c" run "${good[@]}"
  expect "2 non-empty ($c) exits 2" test "$RC" -eq 2
  expect "2 non-empty ($c) names the check" outhas "target database is not empty"
  expect "2 non-empty ($c) stops nothing, restores nothing" bash -c "! grep -qE ' stop |restore.sh|rclone|migrate.js' '$LOG'"
done
COUNTS_BEFORE="0|0|biddaloy_other" run "${good[@]}"
expect "2 connected to another database name exits 2" test "$RC" -eq 2
COUNTS_BEFORE="garbage" run "${good[@]}"
expect "2 unreadable check fails closed (exit 1)" test "$RC" -eq 1
expect "2 unreadable check restores nothing" hasnt "restore.sh"
FAIL_MATCH="psql -U" run "${good[@]}"
expect "2 psql failure fails closed (exit 1)" test "$RC" -eq 1
expect "2 psql failure restores nothing" hasnt "restore.sh"

# 3. confirmation
run --age-key-file "$WORK/k/key.txt" --from latest-hourly --yes-restore-prod biddaloy_staging
expect "3 wrong db name exits 2" test "$RC" -eq 2
expect "3 wrong db name: no docker call" test ! -s "$LOG"
run --age-key-file "$WORK/k/key.txt" --from latest-hourly
expect "3 missing confirmation exits 2" test "$RC" -eq 2
expect "3 missing confirmation: no docker call" test ! -s "$LOG"
run --age-key-file "$WORK/k/key.txt" --from latest-hourly --yes-restore-prod "${DB}x"
expect "3 prefix of the name is not enough" test "$RC" -eq 2

# 4. key file
for f in kopen/key.txt klink/key.txt kmissing/key.txt kextra/key.txt; do
  run --age-key-file "$WORK/$f" --from latest-hourly --yes-restore-prod "$DB"
  expect "4 key file $f refused (exit 2, no docker)" bash -c "[[ $RC -eq 2 && ! -s '$LOG' ]]"
done
chmod 400 "$WORK/k/key.txt"
run "${good[@]}"
expect "4 mode 0400 accepted" test "$RC" -eq 0
chmod 600 "$WORK/k/key.txt"
RESTORE_KEY_UID=99999 run "${good[@]}"
expect "4 key owned by another uid refused, names chown (exit 2, no docker)" bash -c "[[ $RC -eq 2 && ! -s '$LOG' ]] && grep -q 'chown 99999' '$WORK/out.txt'"

# 5. --from
for f in "latest" "db/hourly/../x.dump.age" "backups/db/x.dump.age" "db/hourly/a b.dump.age" "/etc/passwd"; do
  run --age-key-file "$WORK/k/key.txt" --from "$f" --yes-restore-prod "$DB"
  expect "5 --from '$f' refused (exit 2, no docker)" bash -c "[[ $RC -eq 2 && ! -s '$LOG' ]]"
done
run --age-key-file "$WORK/k/key.txt" --from db/hourly/20261021T100000Z.dump.age --yes-restore-prod "$DB"
expect "5 explicit key restores that key" has "restore.sh db/hourly/20261021T100000Z.dump.age @env"
run --age-key-file "$WORK/k/key.txt" --from db/hourly/20990101T000000Z.dump.age --yes-restore-prod "$DB"
expect "5 explicit key that is not in the bucket exits 1, nothing stopped" bash -c "[[ $RC -eq 1 ]] && ! grep -qE ' stop |restore.sh' '$LOG'"

run --age-key-file "$WORK/k/key.txt" --from db/hourly/20261020T100000Z.dump.age --yes-restore-prod "$DB"
expect "5 a 50 hour old dump is refused (exit 2, nothing stopped)" bash -c "[[ $RC -eq 2 ]] && ! grep -qE ' stop |restore.sh' '$LOG'"
run --age-key-file "$WORK/k/key.txt" --from db/hourly/20261020T100000Z.dump.age --yes-restore-prod "$DB" --max-age-hours 100
expect "5 --max-age-hours 100 allows it" test "$RC" -eq 0
run "${good[@]}"
expect "5 the listing runs with TZ=UTC" has "-e TZ=UTC"
expect "5 the empty check ignores default-school" has "default-school"
expect "5 the empty check counts users" has "public.users"

# 6. restore.sh says the target has data (exit 3)
FAIL_MATCH="restore.sh" FAIL_RC=3 run "${good[@]}"
expect "6 restore.sh exit 3 -> exit 1 (the app was already stopped)" test "$RC" -eq 1
expect "6 deploys.log gets a refused line" grep -q " refused" "$WORK/opt/prod/deploys.log"
expect "6 no files copy, no migrate" bash -c "! grep -qE 'rclone|migrate.js' '$LOG'"
expect "6 names the likely mistake" outhas "you probably want a normal deploy"

# 7. restore.sh fails
FAIL_MATCH="restore.sh" FAIL_RC=1 run "${good[@]}"
expect "7 restore failure exits 1" test "$RC" -eq 1
expect "7 prints FAILED at / Why / State / Next" bash -c "grep -q 'FAILED at: restore-db' '$WORK/out.txt' && grep -q 'Why:' '$WORK/out.txt' && grep -q 'State:' '$WORK/out.txt' && grep -q 'Next:' '$WORK/out.txt'"
expect "7 no files copy, no migrate, no start" bash -c "! grep -qE 'rclone|migrate.js| up ' '$LOG'"

# 8. files failure is a warning
FAIL_MATCH="rclone copy" run "${good[@]}"
expect "8 files failure still exits 0" test "$RC" -eq 0
expect "8 deploys.log ok-files-missing" grep -q "ok-files-missing" "$WORK/opt/prod/deploys.log"
expect "8 warns" outhas "WARN: copying the uploaded files back failed"
expect "8 still migrates" has "migrate.js run"
run "${good[@]}" --skip-files
expect "8 --skip-files does not copy" bash -c "[[ $RC -eq 0 ]] && ! grep -q 'rclone copy' '$LOG'"

# 9. verify
COUNTS_AFTER="0|0|$DB" run "${good[@]}"
expect "9 restored DB without a school exits 1" test "$RC" -eq 1
expect "9 failed at verify" outhas "FAILED at: verify"
PENDING_RC=0 run "${good[@]}"
expect "9 no pending migrations: no migrate run" bash -c "[[ $RC -eq 0 ]] && ! grep -q 'migrate.js run' '$LOG'"
FAIL_MATCH="migrate.js run" run "${good[@]}"
expect "9 migrate failure exits 1 and says do not re-run" bash -c "[[ $RC -eq 1 ]] && grep -q 'do not re-run' '$WORK/out.txt'"

# 10. busy lock
FLOCK_FAIL=1 run "${good[@]}"
expect "10 busy lock exits 1 before any docker call" bash -c "[[ $RC -eq 1 ]] && ! grep -q '^docker' '$LOG'"

# 11/12. secrets and compose flags over a whole successful run
run "${good[@]}"
expect "11 no secret in any shim argument or output" bash -c "! grep -qF -e '$SECRET_PW' -e 'AGE-SECRET-KEY' '$LOG' '$WORK/out.txt'"
expect "12 every compose call has project dir and file" bash -c "! grep '^docker compose' '$LOG' | grep -v -- '--project-directory $WORK/opt/prod -f $WORK/opt/repo/deploy/stack.yml'"
expect "12 every compose call is project prod" bash -c "! grep '^docker compose' '$LOG' | grep -v 'compose -p prod '"
expect "12 the only other docker call reads the volume's age" bash -c "! grep '^docker ' '$LOG' | grep -v '^docker compose' | grep -v 'volume inspect -f {{.CreatedAt}} prod_pgdata'"

# 13. latest-* never picks a dump this VM wrote of its own empty database (M4)
VOL_CREATED="$VOL_10H" run "${good[@]}"
expect "13 a dump newer than this VM's volume is skipped" bash -c "[[ $RC -eq 0 ]] && grep -q 'restore.sh db/hourly/20261021T100000Z.dump.age' '$LOG'"
expect "13 says it skipped them" outhas "skipping dumps written since"
VOL_CREATED="$VOL_10H" run --age-key-file "$WORK/k/key.txt" --from db/hourly/20261022T120000Z.dump.age --yes-restore-prod "$DB"
expect "13 an exact --from is taken as given" has "restore.sh db/hourly/20261022T120000Z.dump.age"
FAIL_MATCH="volume inspect" run "${good[@]}"
expect "13 unreadable volume age fails closed, nothing stopped" bash -c "[[ $RC -eq 1 ]] && ! grep -qE ' stop |restore.sh' '$LOG'"
VOL_CREATED="$(date -u -d '100 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-100H '+%Y-%m-%dT%H:%M:%SZ')" run "${good[@]}"
expect "13 only own dumps in the bucket: none found, nothing stopped" bash -c "[[ $RC -eq 1 ]] && ! grep -qE ' stop |restore.sh' '$LOG'"

# 14. prod's last ok compose file wins over the live checkout
printf 'x\n' > "$WORK/opt/prod/stack.yml"
run "${good[@]}"
expect "14 uses prod/stack.yml when the deploy kept one" has "-f $WORK/opt/prod/stack.yml"
rm -f "$WORK/opt/prod/stack.yml"

echo
if [[ $fails -eq 0 ]]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
