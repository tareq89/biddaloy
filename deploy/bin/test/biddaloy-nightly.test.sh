#!/usr/bin/env bash
# Test for deploy/bin/biddaloy-nightly. Pure bash: docker, curl, flock, journalctl and sleep are
# PATH shims that append their arguments to $WORK/calls.log. No Docker, no network.
#
#   bash deploy/bin/test/biddaloy-nightly.test.sh
#
# Cases: 1 staging-refresh success runs the steps in order, pushes `up`, deploy lock before swap
# lock; 2 a migrate failure pushes `down&msg=migrate` and never swaps; 3 a smoke failure after the
# swap swaps back, restarts the app and pushes `down`; 4 a busy lock exits 1 before any docker call;
# 5 demo-rebuild: exit 3 still restarts the app (warning), another code does not and pushes down;
# 6 log-archive exports, archives and pushes up; 7 no secret reaches a shim's arguments;
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
if [[ -n "${FAIL_MATCH:-}" && "$line" == *"$FAIL_MATCH"* ]]; then exit "${FAIL_RC:-1}"; fi
case "$line" in
  "ps --format"*) printf 'prod-app-1\nprod-db-1\n' ;;
  "logs "*) echo "line from $*" ;;
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
printf 'POSTGRES_DB=biddaloy_staging\nSTAGING_REFRESH_PUSH_URL=https://kuma.test/api/push/STAGINGTOKEN?status=up&msg=OK&ping=\nSMOKE_SCHOOL_SLUG=smoke\nSMOKE_ADMIN_EMAIL=a@x.test\nSMOKE_ADMIN_PASSWORD=%s\nSMOKE_TEACHER_EMAIL=t@x.test\nSMOKE_TEACHER_PASSWORD=%s\nSMOKE_SUPER_ADMIN_EMAIL=s@x.test\nSMOKE_SUPER_ADMIN_PASSWORD=%s\n' \
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

# 1 success
run staging-refresh
expect "1 exit 0" test "$RC" = 0
expect "1 pushed up" has "status=up&msg=ok"
steps=(staging-refresh.sh migrate.js "stop app" "db-swap.sh biddaloy_staging biddaloy_staging_next" FLUSHALL "up -d app" "exec -T app wget" smoke-post-deploy.mjs "--drop-prev-old biddaloy_staging")
prev=0; inorder=yes
for s in "${steps[@]}"; do
  n="$(at "$s")"; [[ -n "$n" && "$n" -gt "$prev" ]] || { inorder="no ($s)"; break; }; prev="$n"
done
expect "1 steps in order ($inorder)" test "$inorder" = yes
expect "1 every compose call has project-directory and -f" test "$(grep -c '^docker compose' "$LOG")" = "$(grep -c -- "--project-directory $WORK/opt/staging -f $WORK/opt/repo/deploy/stack.yml" "$LOG")"
expect "1 deploy lock (fd 8) before swap lock (fd 9)" test "$(at "flock -w 3600 8")" -lt "$(at "flock -w 3600 9")"
expect "1 migrate targets _next via env, not argv" has "run --rm -T --no-deps app node server/dist/scripts/migrate.js run"

# 2 migrate fails: down, never swapped, app not stopped
FAIL_MATCH=migrate.js run staging-refresh
expect "2 exit 1" test "$RC" = 1
expect "2 down&msg=migrate" has "status=down&msg=migrate"
expect "2 never swapped" hasnt "db-swap.sh"
expect "2 never stopped the app" hasnt "stop app"

# 3 smoke fails after the swap: swap back, restart, down
FAIL_MATCH=smoke-post-deploy.mjs run staging-refresh
expect "3 exit 1" test "$RC" = 1
expect "3 swapped back" has "db-swap.sh biddaloy_staging biddaloy_staging_prev"
expect "3 app restarted after the swap back" test "$(grep -c 'up -d app' "$LOG")" = 2
expect "3 down&msg=smoke" has "status=down&msg=smoke"
expect "3 did not drop _prev_old" hasnt "--drop-prev-old"

# 3b swap itself fails: no swap-back (db-swap rolls itself back), app restarted
FAIL_MATCH="db-swap.sh biddaloy_staging biddaloy_staging_next" run staging-refresh
expect "3b app restarted, no swap back" test "$(grep -c 'up -d app' "$LOG")" = 1 -a "$(grep -c '_prev$' "$LOG")" = 0
expect "3b down&msg=swap" has "status=down&msg=swap"

# 4 a busy lock never reaches docker
FLOCK_FAIL=1 run staging-refresh
expect "4 exit 1" test "$RC" = 1
expect "4 no docker call" hasnt "docker "
expect "4 waited with -w" has "flock -w 3600"

# 4b Kuma unreachable is not fatal
CURL_FAIL=1 run staging-refresh
expect "4b exit 0 when the push fails" test "$RC" = 0

# 5 demo
run demo-rebuild
expect "5 ok: restarts and pushes up" test "$RC" = 0 -a "$(grep -c 'restart app' "$LOG")" = 1
FAIL_MATCH=reset.sh FAIL_RC=3 run demo-rebuild
expect "5 exit 3: still restarts the app" has "restart app"
expect "5 exit 3: up with a warning" has "status=up&msg=ok++warning"
FAIL_MATCH=reset.sh FAIL_RC=1 run demo-rebuild
expect "5 other code: no restart" hasnt "restart app"
expect "5 other code: down&msg=reset" has "status=down&msg=reset"

# 6 log archive
run log-archive
expect "6 exit 0" test "$RC" = 0
expect "6 exported a gz per container and host.log.gz" test -f "$WORK/opt/logs-export/$(ls "$WORK/opt/logs-export")/host.log.gz" -a -f "$WORK/opt/logs-export/$(ls "$WORK/opt/logs-export")/prod-app-1.log.gz"
expect "6 archive job mounts the export" has "-v $WORK/opt/logs-export:/export jobs /app/log-archive.sh"
expect "6 up" has "status=up&msg=ok"

# 7 secrets: the password and hash never appear in any shim's arguments, nor in the output
: > "$LOG"; run staging-refresh
expect "7 password not in argv" hasnt "$SECRET_PW"
expect "7 no hash made on the host (the .env holds STAGING_PASSWORD_HASH_B64)" hasnt "password-hash.js"
expect "7 no STAGING_PASSWORD_HASH handed to the job" hasnt "STAGING_PASSWORD_HASH"
expect "7 push URL token not in argv" test "$(grep '^curl' "$LOG" | grep -c STAGINGTOKEN)" = 0

# 8 the unit must not wrap the script in flock: that takes the swap lock before deploy.lock
UNIT="$HERE/../../../infra/ansible/templates/biddaloy-nightly@.service.j2"
expect "8 unit ExecStart is the bare script" grep -qx 'ExecStart=/usr/local/bin/biddaloy-nightly %i' "$UNIT"

[[ $fails -eq 0 ]] || { echo "$fails failed"; exit 1; }
echo "all passed"
