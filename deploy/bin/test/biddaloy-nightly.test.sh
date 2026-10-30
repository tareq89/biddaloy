#!/usr/bin/env bash
# Test for deploy/bin/biddaloy-nightly. Pure bash: docker, curl, flock, journalctl and sleep are
# PATH shims that append their arguments to $WORK/calls.log. No Docker, no network.
#
#   bash deploy/bin/test/biddaloy-nightly.test.sh
#
# Cases: 1 restore-drill success runs the steps in order, pushes `up`, deploy lock before swap
# lock, never touches the live staging; 2 migrate and 3 smoke failures push `down` and still drop the
# drill db and flush its redis db 15; 3b low memory pushes down without restoring; 3c staging-refresh is retired; 4 a busy lock exits 1 before any docker call;
# 5 demo-rebuild: exit 3 still restarts the app (warning), another code does not and pushes down;
# 6 log-archive exports (deploy-only), hands the job a tar on stdin, removes the export after
# success and keeps it after a failure; 7 no secret reaches a shim's arguments;
# 8 the systemd unit runs the script bare (no flock wrapper, it would invert the lock order).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../biddaloy-nightly"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/opt/staging" "$WORK/opt/demo" "$WORK/opt/prod" "$WORK/opt/repo"
LOG="$WORK/calls.log"

# docker: FAIL_MATCH = substring of the argument line that makes the call exit FAIL_RC (default 1).
cat > "$WORK/bin/docker" <<'SHIM'
#!/usr/bin/env bash
line="$*"
echo "docker $line" >> "$WORK/calls.log"
# The archive job reads a tar of the export on stdin: keep it to look inside.
if [[ "$line" == *log-archive.sh* ]]; then cat > "$WORK/archive.tar"; fi
if [[ -n "${FAIL_MATCH:-}" && "$line" == *"$FAIL_MATCH"* ]]; then exit "${FAIL_RC:-1}"; fi
case "$line" in
  "ps --format"*) printf 'prod-app-1\nprod-db-1\n' ;;
  "logs "*) echo "line from $*" ;;
  *"redis-cli -n 15 FLUSHDB"*) echo OK ;;
esac
exit 0
SHIM
cat > "$WORK/bin/curl" <<'SHIM'
#!/usr/bin/env bash
echo "curl $*" >> "$WORK/calls.log"
while IFS= read -r l; do echo "push $l" >> "$WORK/calls.log"; done
[[ -z "${CURL_FAIL:-}" ]]
SHIM
cat > "$WORK/bin/flock" <<'SHIM'
#!/usr/bin/env bash
echo "flock $*" >> "$WORK/calls.log"
[[ -z "${FLOCK_FAIL:-}" ]]
SHIM
cat > "$WORK/bin/journalctl" <<'SHIM'
#!/usr/bin/env bash
echo "journalctl $*" >> "$WORK/calls.log"
echo host-line
SHIM
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/sleep"
chmod +x "$WORK/bin/"*

SECRET_PW='sup3r-secret-pw'
printf 'POSTGRES_DB=biddaloy_staging\nRESTORE_DRILL_PUSH_URL=https://kuma.test/api/push/STAGINGTOKEN?status=up&msg=OK&ping=\nSMOKE_SCHOOL_SLUG=smoke\nSMOKE_ADMIN_EMAIL=a@x.test\nSMOKE_ADMIN_PASSWORD=%s\nSMOKE_TEACHER_EMAIL=t@x.test\nSMOKE_TEACHER_PASSWORD=%s\nSMOKE_SUPER_ADMIN_EMAIL=s@x.test\nSMOKE_SUPER_ADMIN_PASSWORD=%s\n' \
  "$SECRET_PW" "$SECRET_PW" "$SECRET_PW" > "$WORK/opt/staging/.env"
echo 'DEMO_RESET_PUSH_URL=https://kuma.test/api/push/DEMOTOKEN' > "$WORK/opt/demo/.env"
echo 'LOG_ARCHIVE_PUSH_URL=https://kuma.test/api/push/LOGTOKEN' > "$WORK/opt/prod/.env"

export PATH="$WORK/bin:$PATH" WORK
export BIDDALOY_ROOT="$WORK/opt" BIDDALOY_REPO="$WORK/opt/repo" BIDDALOY_SWAP_LOCK="$WORK/swap.lock" NIGHTLY_SLEEP=0

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
expect() { if "${@:2}"; then ok "$1"; else bad "$1"; fi; }
has() { grep -qF -- "$1" "$LOG"; }
hasnt() { ! has "$1"; }
# line number of the first call containing $1
at() { grep -nF -- "$1" "$LOG" | head -1 | cut -d: -f1; }
run() { : > "$LOG"; RC=0; "$SCRIPT" "$@" >"$WORK/out" 2>&1 || RC=$?; }

# 1 success: latest daily -> drill db -> migrate -> smoke on a one-off app -> drop; staging is never stopped
printf 'MemAvailable:    4000000 kB\n' > "$WORK/meminfo"
export NIGHTLY_MEMINFO="$WORK/meminfo"
run restore-drill
expect "1 exit 0" test "$RC" = 0
expect "1 pushed up" has "status=up&msg=ok"
steps=("staging-refresh.sh --target biddaloy_staging_drill --from latest-daily" migrate.js "redis-cli -n 15 FLUSHDB" smoke-post-deploy.mjs "DROP DATABASE IF EXISTS")
prev=0; inorder=yes
for s in "${steps[@]}"; do
  n="$(at "$s")"; [[ -n "$n" && "$n" -gt "$prev" ]] || { inorder="no ($s)"; break; }; prev="$n"
done
expect "1 steps in order ($inorder)" test "$inorder" = yes
expect "1 every compose call has project-directory and -f" test "$(grep -c '^docker compose' "$LOG")" = "$(grep -c -- "--project-directory $WORK/opt/staging -f $WORK/opt/repo/deploy/stack.yml" "$LOG")"
expect "1 deploy lock (fd 8) before swap lock (fd 9)" test "$(at "flock -w 3600 8")" -lt "$(at "flock -w 3600 9")"
expect "1 migrate targets the drill db via env, not argv" has "run --rm -T --no-deps app node server/dist/scripts/migrate.js run"
expect "1 smoke app uses its own redis db" has "REDIS_URL=redis://redis:6379/15"
expect "1 last-drill written with duration and counts" grep -q 'duration=' "$WORK/opt/staging/last-drill"
expect "1 live staging never stopped, swapped, flushed or dropped" bash -c "! grep -qE 'stop app|db-swap|FLUSHALL|up -d app|IF EXISTS \"biddaloy_staging\" ' '$LOG'"

# 1b like the VM: the staging dir does not let deploy create files, provision made last-drill empty.
# The drill must write it in place (a tmp file + mv would fail here).
: > "$WORK/opt/staging/last-drill"
chmod 0550 "$WORK/opt/staging"
run restore-drill
chmod 0750 "$WORK/opt/staging"
expect "1b exit 0" test "$RC" = 0
expect "1b last-drill written in place in a read-only dir" grep -q 'duration=' "$WORK/opt/staging/last-drill"
expect "1b no last-drill warning" hasnt "last-drill+not+written"

# 2 migrate fails: down, drill db still dropped, no smoke
rm -f "$WORK/opt/staging/last-drill"
FAIL_MATCH=migrate.js run restore-drill
expect "2 exit 1" test "$RC" = 1
expect "2 down&msg=migrate" has "status=down&msg=migrate"
expect "2 drill db dropped anyway" has "DROP DATABASE IF EXISTS"
expect "2 no smoke" hasnt "smoke-post-deploy.mjs"
expect "2 no last-drill" test ! -e "$WORK/opt/staging/last-drill"
expect "2 redis db 15 flushed on exit anyway" has "redis-cli -n 15 FLUSHDB"

# 3 smoke fails: down, drill db still dropped
FAIL_MATCH=smoke-post-deploy.mjs run restore-drill
expect "3 exit 1" test "$RC" = 1
expect "3 down&msg=smoke" has "status=down&msg=smoke"
expect "3 drill db dropped anyway" has "DROP DATABASE IF EXISTS"
expect "3 no last-drill" test ! -e "$WORK/opt/staging/last-drill"
expect "3 redis db 15 flushed after the smoke (exit trap)" test "$(grep -c 'redis-cli -n 15 FLUSHDB' "$LOG")" -ge 2

# 3b low memory: down, nothing restored
printf 'MemAvailable:    500000 kB\n' > "$WORK/meminfo"
run restore-drill
expect "3b exit 1" test "$RC" = 1
expect "3b down&msg=not+enough+memory" has "status=down&msg=not+enough+memory"
expect "3b nothing restored" hasnt "staging-refresh.sh"
printf 'MemAvailable:    4000000 kB\n' > "$WORK/meminfo"

# 3c the old job name is gone: exit 2, no docker call
run staging-refresh
expect "3c staging-refresh exits 2 with the pointer" test "$RC" = 2 -a "$(grep -c 'biddaloy-staging load' "$WORK/out")" = 1
expect "3c no docker call" hasnt "docker "

# 3d the old push variable still works for one release; the new one wins when both are set
cp "$WORK/opt/staging/.env" "$WORK/env.keep"
printf 'STAGING_REFRESH_PUSH_URL=https://kuma.test/api/push/OLDTOKEN\n' >> "$WORK/opt/staging/.env"
run restore-drill
expect "3d new push var wins when both are set" bash -c "grep -qF STAGINGTOKEN '$LOG' && ! grep -qF OLDTOKEN '$LOG'"
sed -i.bak '/^RESTORE_DRILL_PUSH_URL/d' "$WORK/opt/staging/.env" && rm -f "$WORK/opt/staging/.env.bak"
run restore-drill
expect "3d old push var used when the new one is unset" has "OLDTOKEN"
cp "$WORK/env.keep" "$WORK/opt/staging/.env"

# 3d2 the default staging active db is biddaloy_staging_dev: the guard lets it through; a non-staging db is refused
sed -i.bak 's/^POSTGRES_DB=.*/POSTGRES_DB=biddaloy_staging_dev/' "$WORK/opt/staging/.env" && rm -f "$WORK/opt/staging/.env.bak"
run restore-drill
expect "3d2 biddaloy_staging_dev passes the guard" test "$RC" = 0 -a "$(grep -c 'not a staging db' "$WORK/out")" = 0
sed -i.bak 's/^POSTGRES_DB=.*/POSTGRES_DB=biddaloy/' "$WORK/opt/staging/.env" && rm -f "$WORK/opt/staging/.env.bak"
run restore-drill
expect "3d2 a prod-named db fails the guard" test "$RC" != 0 -a "$(grep -c 'not a staging db' "$WORK/out")" = 1
cp "$WORK/env.keep" "$WORK/opt/staging/.env"

# 3e a drill db that cannot be dropped after a good night is a warning, not silence
rm -f "$WORK/opt/staging/last-drill"
FAIL_MATCH="DROP DATABASE" run restore-drill
expect "3e up with a warning" has "status=up&msg=ok"
expect "3e warning names the drop" has "drill+db+not+dropped"
expect "3e no last-drill claimed" test ! -e "$WORK/opt/staging/last-drill"

# 4 a busy lock never reaches docker
FLOCK_FAIL=1 run restore-drill
expect "4 exit 1" test "$RC" = 1
expect "4 no docker call" hasnt "docker "
expect "4 waited with -w" has "flock -w 3600"
expect "4 pushes down for the lock" has "status=down&msg=deploy+lock"

# 4b Kuma unreachable is not fatal
CURL_FAIL=1 run restore-drill
expect "4b exit 0 when the push fails" test "$RC" = 0

# 5 demo
run demo-rebuild
expect "5 ok: restarts and pushes up" test "$RC" = 0 -a "$(grep -c 'restart app' "$LOG")" = 1
expect "5 ok: mailpit restarted after the app" test "$(grep -c 'restart mailpit' "$LOG")" = 1
FAIL_MATCH=reset.sh FAIL_RC=3 run demo-rebuild
expect "5 exit 3: still restarts the app" has "restart app"
expect "5 exit 3: up with a warning" has "status=up&msg=ok++warning"
FAIL_MATCH=reset.sh FAIL_RC=1 run demo-rebuild
expect "5 other code: no restart" hasnt "restart app"
expect "5 other code: mailpit not restarted" hasnt "restart mailpit"
expect "5 other code: down&msg=reset" has "status=down&msg=reset"

# 6 log archive: the job gets a tar on stdin (no bind mount), the host copy goes after success
mkdir -p "$WORK/opt/logs-export"
rm -f "$WORK/archive.tar"
run log-archive
expect "6 exit 0" test "$RC" = 0
expect "6 tar holds a gz per container and host.log.gz" bash -c "tar -tf '$WORK/archive.tar' | grep -q '/host.log.gz\$' && tar -tf '$WORK/archive.tar' | grep -q '/prod-app-1.log.gz\$'"
expect "6 no bind mount of the export" hasnt ":/export"
expect "6 the job unpacks into its own /tmp" has "-e LOG_ARCHIVE_EXPORT_DIR=/tmp/export jobs sh -c"
expect "6 host export removed after success" test -z "$(ls -A "$WORK/opt/logs-export")"
expect "6 up" has "status=up&msg=ok"
FAIL_MATCH=log-archive.sh run log-archive
expect "6 archive failure exits 1, pushes down" bash -c "[[ $RC -eq 1 ]] && grep -qF 'status=down&msg=archive' '$LOG'"
expect "6 archive failure keeps the host export" test -n "$(ls -A "$WORK/opt/logs-export")"
d="$(find "$WORK/opt/logs-export" -mindepth 1 -maxdepth 1 | head -1)"
expect "6 export is deploy-only (0700)" test "$(stat -c %a "$d" 2>/dev/null || stat -f %Lp "$d")" = 700
rm -rf "$WORK/opt/logs-export"
# 6b a stack's last ok compose file wins over the live checkout
printf 'x\n' > "$WORK/opt/prod/stack.yml"
run log-archive
expect "6b uses <stack>/stack.yml when the deploy kept one" has "-f $WORK/opt/prod/stack.yml"
rm -f "$WORK/opt/prod/stack.yml"
# 6c the staging smoke script is the copy staging's last ok deploy kept, not the checkout's
printf 'x\n' > "$WORK/opt/staging/smoke-post-deploy.mjs"
run restore-drill
expect "6c smoke mounts <stack>/smoke-post-deploy.mjs" has "-v $WORK/opt/staging/smoke-post-deploy.mjs:/tmp/smoke-post-deploy.mjs:ro"
rm -f "$WORK/opt/staging/smoke-post-deploy.mjs"

# 7 secrets: the password and hash never appear in any shim's arguments, nor in the output
: > "$LOG"; run restore-drill
expect "7 password not in argv" hasnt "$SECRET_PW"
expect "7 no hash made on the host (the .env holds STAGING_PASSWORD_HASH_B64)" hasnt "password-hash.js"
expect "7 no STAGING_PASSWORD_HASH handed to the job" hasnt "STAGING_PASSWORD_HASH"
expect "7 push URL token not in argv" test "$(grep '^curl' "$LOG" | grep -c STAGINGTOKEN)" = 0

# 8 the unit must not wrap the script in flock: that takes the swap lock before deploy.lock
UNIT="$HERE/../../../infra/ansible/templates/biddaloy-nightly@.service.j2"
expect "8 unit ExecStart is the bare script" grep -qx 'ExecStart=/usr/local/bin/biddaloy-nightly %i' "$UNIT"

[[ $fails -eq 0 ]] || { echo "$fails failed"; exit 1; }
echo "all passed"
