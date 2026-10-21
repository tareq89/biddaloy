#!/usr/bin/env bash
# Tests for deploy/bin/biddaloy-deploy. Pure bash: git, ansible-playbook and flock are shims.
# Run: bash deploy/bin/test/biddaloy-deploy.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Found before the shims shadow it: the inert-reason check below needs the real one (CI has it).
REAL_AP="$(command -v ansible-playbook || true)"
DEPLOY="$HERE/../biddaloy-deploy"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
UP=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
SHA2=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export BIDDALOY_ROOT="$T/root"
export SHIM_LOG="$T/shim.log"
export MARKER="$T/pwned"
export FINISHED="$T/finished"

mkdir -p "$T/bin" "$BIDDALOY_ROOT/repo/.git"
# git: records the call. cat-file / branch fail for the sha in GIT_UNKNOWN_SHA.
cat > "$T/bin/git" <<'EOF'
#!/usr/bin/env bash
echo "git $*" >> "$SHIM_LOG"
case "$*" in *"${GIT_UNKNOWN_SHA:-no-such-sha}"*) exit 1 ;; esac
case "$*" in *"merge-base"*"${NOT_MAIN_SHA:-no-such-sha}"*) exit 1 ;; esac
case "$*" in *"${NO_CLI_SHA:-no-such-sha}:deploy/bin"*) exit 1 ;; esac
case " $* " in *" branch "*) echo "  origin/main" ;; esac
case " $* " in *" rev-parse "*) echo "${REVPARSE_OUT:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;; esac
exit 0
EOF
# ansible-playbook: records args and BIDDALOY_HOTFIX_REASON; fails for the stack in ANSIBLE_FAIL_STACK.
cat > "$T/bin/ansible-playbook" <<'EOF'
#!/usr/bin/env bash
echo "ansible $*" >> "$SHIM_LOG"
echo "locale: $LC_ALL cfg: $ANSIBLE_CONFIG" >> "$SHIM_LOG"
[ -n "${ANSIBLE_SLOW:-}" ] && sleep 2
echo "hotfix-env: [${BIDDALOY_HOTFIX_REASON-unset}]" >> "$SHIM_LOG"
case "$*" in *"stack=${ANSIBLE_FAIL_STACK:-none} "*) echo "TASK failed"; exit 2 ;; esac
echo "PLAY RECAP ok"
[ -n "${ANSIBLE_SLOW:-}" ] && touch "$FINISHED"
exit 0
EOF
cat > "$T/bin/setsid" <<'EOF'
#!/usr/bin/env bash
# macOS has no setsid; the real one only changes the session.
[ "$1" = --wait ] && shift
exec "$@"
EOF
cat > "$T/bin/ssh" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do echo "ssharg: $a" >> "$SHIM_LOG"; done
EOF
# flock: used only when the host has no real one (macOS). FLOCK_BUSY=1 pretends it is held.
HAVE_FLOCK=0
if command -v flock > /dev/null 2>&1; then HAVE_FLOCK=1; else
cat > "$T/bin/flock" <<'EOF'
#!/usr/bin/env bash
[ "${FLOCK_BUSY:-0}" = 1 ] && exit 1
exit 0
EOF
fi
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH"

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
reset() { : > "$SHIM_LOG"; rm -f "$MARKER"; unset ANSIBLE_FAIL_STACK FLOCK_BUSY GIT_UNKNOWN_SHA NOT_MAIN_SHA NO_CLI_SHA ANSIBLE_SLOW SSH_ORIGINAL_COMMAND; : > "$BIDDALOY_ROOT/deploy.lock"; }
# run <desc> <expected exit> -- cmd...   (stdout+stderr in $T/out)
run() {
  local desc="$1" want="$2"; shift 3
  "$@" > "$T/out" 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then ok "$desc"; else bad "$desc (exit $got, want $want)"; cat "$T/out"; fi
}
has() { if grep -qF -- "$2" "$1"; then ok "$3"; else bad "$3 (missing: $2)"; cat "$1"; fi; }
hasnt() { if grep -qF -- "$2" "$1"; then bad "$3 (found: $2)"; cat "$1"; else ok "$3"; fi; }
from_github() { SSH_ORIGINAL_COMMAND="$1" bash "$DEPLOY" --from-github; }

reset
run "bad stack exits 2" 2 -- bash "$DEPLOY" nope "$SHA"
run "short sha exits 2" 2 -- bash "$DEPLOY" prod abc1234
run "uppercase sha exits 2" 2 -- bash "$DEPLOY" prod "$UP"
run "unknown flag exits 2" 2 -- bash "$DEPLOY" staging "$SHA" --rm-rf
run "hotfix with a quote exits 2" 2 -- bash "$DEPLOY" staging "$SHA" --hotfix 'a"b c'
# Ansible templates what it is given: anything Jinja can parse is refused before ansible.
for r in "{{ lookup('pipe', 'touch $MARKER') }}" '{% if 1 %}x{% endif %}' 'fix #12 now' 'up 100% now' 'a {{ b'; do
  run "hotfix reason with Jinja characters exits 2: $r" 2 -- bash "$DEPLOY" prod "$SHA" --hotfix "$r"
done
run "Jinja in the stack exits 2" 2 -- bash "$DEPLOY" '{{7*7}}' "$SHA"
hasnt "$SHIM_LOG" "ansible" "refusals never reach ansible"

# --from-github: every one of these must be refused (exit 2) and never run anything.
BAD=(
  'prod short'
  'prod abc1234'
  "staging $UP"
  "prod $SHA extra"
  "all $SHA"
  "prod $SHA --skip-backup"
  "prod $SHA --hotfix \"ab\""
  "prod $SHA --hotfix \"a\$(touch $MARKER)\""
  "prod $SHA --hotfix \"a\`touch $MARKER\`\""
  "prod $SHA --hotfix \"a\"b\""
  "prod $SHA --hotfix \"it's\""
  "prod $SHA --hotfix \"a;b c\""
  "prod $SHA --hotfix \"{{ lookup('pipe', 'touch $MARKER') }}\""
  "prod $SHA --hotfix \"{% raw %}x\""
  "prod $SHA --hotfix \"fix #12\""
  "prod \$(touch $MARKER)"
  "prod $SHA; touch $MARKER"
  "prod $SHA && touch $MARKER"
  "prod $SHA | cat"
  "prod \`touch $MARKER\`"
  "staging $SHA"$'\n'"prod $SHA"
  "staging $SHA"$'\n'"touch $MARKER"
  "--last-ok demo"
  "--last-ok staging extra"
  "bash -c id"
  ""
)
for c in "${BAD[@]}"; do
  reset
  run "refused: ${c//$'\n'/\\n}" 2 -- from_github "$c"
  if [ -e "$MARKER" ]; then bad "injection ran a command"; fi
  hasnt "$SHIM_LOG" "ansible" "no ansible after a refused command"
done
reset
run "--from-github with extra args exits 2" 2 -- env SSH_ORIGINAL_COMMAND="staging $SHA" bash "$DEPLOY" --from-github staging
run "--from-github with no command exits 2" 2 -- bash "$DEPLOY" --from-github

# Allowed forms.
reset
run "github staging ok" 0 -- from_github "staging $SHA"
has "$SHIM_LOG" "stack=staging -e version=$SHA" "ansible got stack and version"
has "$SHIM_LOG" "git -C $BIDDALOY_ROOT/repo checkout --quiet --detach $SHA" "checked out the sha"
reset
run "github hotfix reason goes through the environment" 0 -- from_github "prod $SHA --hotfix \"fix: login, see 12/a.b\""
has "$SHIM_LOG" 'hotfix-env: [fix: login, see 12/a.b]' "reason is in BIDDALOY_HOTFIX_REASON"
hasnt "$SHIM_LOG" "hotfix_reason" "reason is not an extra var"
hasnt "$SHIM_LOG" " -e @" "no extra-vars file"
has "$SHIM_LOG" "-e stack=prod -e version=$SHA" "ansible gets -e stack= -e version="
reset
run "laptop hotfix reason goes through the environment" 0 -- bash "$DEPLOY" prod "$SHA" --hotfix "first deploy"
has "$SHIM_LOG" 'hotfix-env: [first deploy]' "laptop reason is in BIDDALOY_HOTFIX_REASON"
reset
BIDDALOY_HOTFIX_REASON="left over" run "a reason in the caller's environment is not passed on" 0 -- bash "$DEPLOY" demo "$SHA"
has "$SHIM_LOG" 'hotfix-env: []' "no --hotfix means an empty reason"

# Unknown sha.
reset
GIT_UNKNOWN_SHA=$SHA2 run "sha not on origin exits 1" 1 -- bash "$DEPLOY" staging "$SHA2"
has "$T/out" "FAILED at: checkout" "FAILED block names the step"
has "$T/out" "Next: push the commit, or check the sha" "FAILED block has a next step"
hasnt "$SHIM_LOG" "ansible" "no ansible for an unknown sha"

# Prod gate from GitHub.
reset
run "github prod without staging ok is refused" 1 -- from_github "prod $SHA"
has "$T/out" "FAILED at: gate prod" "gate names itself"
hasnt "$SHIM_LOG" "ansible" "gate stops before ansible"
mkdir -p "$BIDDALOY_ROOT/staging"
echo "2026-10-22T01:00:00Z staging $SHA ok" > "$BIDDALOY_ROOT/staging/deploys.log"
reset
run "github prod after staging ok runs" 0 -- from_github "prod $SHA"
has "$SHIM_LOG" "stack=prod -e version=$SHA" "prod deployed"
reset
run "github prod with a hotfix skips the gate" 0 -- from_github "prod $SHA2 --hotfix \"urgent fix\""
has "$SHIM_LOG" "stack=prod -e version=$SHA2" "hotfix prod deployed"

# Lock.
reset
FLOCK_BUSY=1 run "busy lock exits 75" 75 -- bash "$DEPLOY" staging "$SHA"
has "$T/out" "FAILED at: lock" "lock FAILED block"
has "$T/out" "Why: another deploy is running" "lock why"
has "$T/out" "Next: wait for it to finish" "lock next"
hasnt "$SHIM_LOG" "ansible" "busy lock never runs ansible"

# Skip backup flag.
reset
run "skip-backup is passed on" 0 -- bash "$DEPLOY" demo "$SHA" --skip-backup
has "$SHIM_LOG" "skip_backup=true" "skip_backup reaches ansible"

# all: documented order, first deploy hotfix on prod, ops only in its group.
reset
rm -f "$BIDDALOY_ROOT/prod/deploys.log"
printf 'prod\nops\n' > "$BIDDALOY_ROOT/host-groups"
run "all runs" 0 -- bash "$DEPLOY" all "$SHA"
order=$(grep '^ansible' "$SHIM_LOG" | sed -E 's/.*stack=([a-z]+) .*/\1/' | tr '\n' ' ')
if [ "$order" = "edge ops staging prod demo " ]; then ok "all order edge ops staging prod demo"; else bad "all order: $order"; fi
hasnt "$SHIM_LOG" "hotfix_reason" "all has no first-deploy hotfix special case"
reset
echo "x prod $SHA ok" > "$BIDDALOY_ROOT/prod/deploys.log"
echo prod > "$BIDDALOY_ROOT/host-groups"
run "all with a hotfix" 0 -- bash "$DEPLOY" all "$SHA" --hotfix "first deploy"
if [ "$(grep -c '^hotfix-env: \[first deploy\]' "$SHIM_LOG")" = 1 ]; then ok "all gives the reason to prod only"; else bad "all hotfix reason count"; cat "$SHIM_LOG"; fi
reset
echo "x prod $SHA ok" > "$BIDDALOY_ROOT/prod/deploys.log"
echo prod > "$BIDDALOY_ROOT/host-groups"
run "all without the ops group skips ops" 0 -- bash "$DEPLOY" all "$SHA"
order=$(grep '^ansible' "$SHIM_LOG" | sed -E 's/.*stack=([a-z]+) .*/\1/' | tr '\n' ' ')
if [ "$order" = "edge staging prod demo " ]; then ok "all skips ops"; else bad "all skips ops: $order"; fi
reset
ANSIBLE_FAIL_STACK=prod run "all stops at the first failure" 1 -- bash "$DEPLOY" all "$SHA"
order=$(grep '^ansible' "$SHIM_LOG" | sed -E 's/.*stack=([a-z]+) .*/\1/' | tr '\n' ' ')
if [ "$order" = "edge staging prod " ]; then ok "nothing after the failed stack ran"; else bad "after failure: $order"; fi
has "$T/out" "FAILED at: ansible deploy prod" "ansible failure block"
has "$T/out" "Why: ansible-playbook exited 2" "ansible failure why"
has "$T/out" "Next: read" "ansible failure next"
has "$BIDDALOY_ROOT/logs/prod-last-deploy.log" "TASK failed" "output goes to logs/<stack>-last-deploy.log"

# --last-ok.
reset
mkdir -p "$BIDDALOY_ROOT/staging"
cat > "$BIDDALOY_ROOT/staging/deploys.log" <<EOF
2026-10-20T01:00:00Z staging $SHA ok
2026-10-21T01:00:00Z staging $SHA2 rolled-back
2026-10-22T01:00:00Z staging $SHA2 failed
EOF
run "--last-ok staging" 0 -- bash "$DEPLOY" --last-ok staging
if [ "$(cat "$T/out")" = "$SHA" ]; then ok "--last-ok prints only the last ok sha"; else bad "--last-ok output: $(cat "$T/out")"; fi
reset
run "--last-ok via github" 0 -- from_github "--last-ok staging"
if [ "$(cat "$T/out")" = "$SHA" ]; then ok "--last-ok via github prints the sha"; else bad "github --last-ok output"; fi
reset
rm -f "$BIDDALOY_ROOT/prod/deploys.log"
run "--last-ok with no ok line exits 1" 1 -- bash "$DEPLOY" --last-ok prod

# H1/L4: ansible gets a UTF-8 locale and the repo's ansible.cfg. H2: log is 0640.
reset
run "deploy for locale" 0 -- bash "$DEPLOY" demo "$SHA"
has "$SHIM_LOG" "locale: C.UTF-8 cfg: $BIDDALOY_ROOT/repo/infra/ansible/ansible.cfg" "ansible runs with C.UTF-8 and the repo ansible.cfg"
mode=$(stat -f %Lp "$BIDDALOY_ROOT/logs/demo-last-deploy.log" 2> /dev/null || stat -c %a "$BIDDALOY_ROOT/logs/demo-last-deploy.log")
if [ "$mode" = 640 ]; then ok "deploy log is 0640"; else bad "deploy log mode $mode"; fi

# H2: a lock file that cannot be opened gives a FAILED block, not a silent exit.
reset
mv "$BIDDALOY_ROOT/deploy.lock" "$T/lock.bak"
mkdir "$BIDDALOY_ROOT/deploy.lock"
run "unopenable lock exits 1" 1 -- bash "$DEPLOY" staging "$SHA"
has "$T/out" "FAILED at: lock" "unopenable lock gives the FAILED block"
rmdir "$BIDDALOY_ROOT/deploy.lock"
mv "$T/lock.bak" "$BIDDALOY_ROOT/deploy.lock"

# H4: the client closing stdout must not stop ansible or truncate the log.
reset
rm -f "$FINISHED"
ANSIBLE_SLOW=1 bash "$DEPLOY" staging "$SHA" 2>&1 | head -n 1 > /dev/null
i=0
while [ ! -e "$FINISHED" ] && [ "$i" -lt 100 ]; do sleep 0.2; i=$((i + 1)); done
if [ -e "$FINISHED" ]; then ok "ansible finished after the client closed stdout"; else bad "ansible did not finish"; fi
sleep 0.5
has "$BIDDALOY_ROOT/logs/staging-last-deploy.log" "PLAY RECAP ok" "log is complete after the client left"

# M1: GitHub may only deploy commits on main; the laptop path is not restricted that way.
reset
NOT_MAIN_SHA=$SHA2 run "github sha off main is refused" 1 -- from_github "staging $SHA2"
has "$T/out" "FAILED at: main check" "main check block"
hasnt "$SHIM_LOG" "ansible" "off-main sha never reaches ansible"
reset
NOT_MAIN_SHA=$SHA2 run "laptop sha off main still deploys" 0 -- bash "$DEPLOY" staging "$SHA2"

# M2: a sha without the CLI is refused before checkout.
reset
NO_CLI_SHA=$SHA2 run "sha without the CLI is refused" 1 -- bash "$DEPLOY" staging "$SHA2"
has "$T/out" "FAILED at: cli check" "cli check block"
hasnt "$SHIM_LOG" "checkout" "no checkout of a commit without the CLI"

# M3: an unreadable staging log fails closed for the prod gate and --last-ok.
if [ "$(id -u)" != 0 ]; then
  reset
  chmod 000 "$BIDDALOY_ROOT/staging/deploys.log"
  run "unreadable staging log refuses prod" 1 -- from_github "prod $SHA"
  run "unreadable staging log fails --last-ok" 1 -- bash "$DEPLOY" --last-ok staging
  chmod 640 "$BIDDALOY_ROOT/staging/deploys.log"
fi

# L6: the real lock, when this host has flock (the shim covers the 75 path otherwise).
if [ "$HAVE_FLOCK" = 1 ]; then
  reset
  ( exec 8>> "$BIDDALOY_ROOT/deploy.lock"; flock -n 8; sleep 5 ) &
  holder=$!
  sleep 0.5
  run "real flock: busy lock exits 75" 75 -- bash "$DEPLOY" staging "$SHA"
  kill "$holder" 2> /dev/null || true
else
  echo "skip real flock test (no flock on this host; the shim covers the 75 path)"
fi

# scripts/deploy.sh: ssh gets "--" before the destination and every argument is quoted.
reset
DEPLOY_SH="$HERE/../../../scripts/deploy.sh"
BIDDALOY_HOST=203.0.113.9 run "deploy.sh runs" 0 -- bash "$DEPLOY_SH" staging "$SHA" --hotfix "fix: a b"
dash=$(grep -n '^ssharg: --$' "$SHIM_LOG" | head -1 | cut -d: -f1)
dest=$(grep -n '^ssharg: deploy@203.0.113.9$' "$SHIM_LOG" | head -1 | cut -d: -f1)
if [ -n "$dash" ] && [ -n "$dest" ] && [ "$dash" -lt "$dest" ]; then ok "deploy.sh puts -- before the destination"; else bad "deploy.sh -- order"; fi
has "$SHIM_LOG" 'ssharg: biddaloy-deploy staging aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --hotfix fix:\ a\ b' "deploy.sh quotes the hotfix reason for the remote shell"
BIDDALOY_HOST='' run "deploy.sh needs BIDDALOY_HOST" 1 -- bash "$DEPLOY_SH" staging "$SHA"

# The playbook side: deploy.yml's own hotfix_note line, fed a Jinja payload through the
# environment, must keep it as text. Needs a real ansible-playbook (CI has one; skipped otherwise).
if [ -n "$REAL_AP" ]; then
  line=$(grep -E "^    hotfix_note: .*BIDDALOY_HOTFIX_REASON" "$HERE/../../../infra/ansible/deploy.yml")
  cat > "$T/inert.yml" <<PLAY
- hosts: localhost
  gather_facts: false
  vars:
$line
  tasks:
    - ansible.builtin.copy:
        content: '{{ hotfix_note }}'
        dest: '$T/inert.out'
        mode: '0600'
PLAY
  rm -f "$MARKER"
  BIDDALOY_HOTFIX_REASON="{{ lookup('ansible.builtin.pipe', 'touch $MARKER') }}" \
    "$REAL_AP" -c local -i localhost, "$T/inert.yml" > "$T/inert.log" 2>&1
  if [ ! -e "$MARKER" ] && grep -qF "{{ lookup(" "$T/inert.out" 2> /dev/null; then
    ok "deploy.yml's hotfix_note keeps a Jinja reason as text"
  else bad "Jinja in BIDDALOY_HOTFIX_REASON was evaluated or lost"; cat "$T/inert.log"; fi
else
  echo "skip inert-reason check (no ansible-playbook on this host; CI runs it)"
fi

echo "-- $pass passed, $fail failed"
[ "$fail" = 0 ]
