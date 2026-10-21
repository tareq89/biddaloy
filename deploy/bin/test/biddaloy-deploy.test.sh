#!/usr/bin/env bash
# Tests for deploy/bin/biddaloy-deploy. Pure bash: git, ansible-playbook and flock are shims.
# Run: bash deploy/bin/test/biddaloy-deploy.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HERE/../biddaloy-deploy"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
UP=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
SHA2=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export BIDDALOY_ROOT="$T/root"
export SHIM_LOG="$T/shim.log"
export MARKER="$T/pwned"

mkdir -p "$T/bin" "$BIDDALOY_ROOT/repo/.git"
# git: records the call. cat-file / branch fail for the sha in GIT_UNKNOWN_SHA.
cat > "$T/bin/git" <<'EOF'
#!/usr/bin/env bash
echo "git $*" >> "$SHIM_LOG"
case "$*" in *"${GIT_UNKNOWN_SHA:-no-such-sha}"*) exit 1 ;; esac
case " $* " in *" branch "*) echo "  origin/main" ;; esac
exit 0
EOF
# ansible-playbook: records args and the -e @file content; fails for the stack in ANSIBLE_FAIL_STACK.
cat > "$T/bin/ansible-playbook" <<'EOF'
#!/usr/bin/env bash
echo "ansible $*" >> "$SHIM_LOG"
for a in "$@"; do case "$a" in @*) echo "extra-vars-file: $(cat "${a#@}")" >> "$SHIM_LOG" ;; esac; done
case "$*" in *"stack=${ANSIBLE_FAIL_STACK:-none} "*) echo "TASK failed"; exit 2 ;; esac
echo "PLAY RECAP ok"
EOF
# flock: pretends the lock is held when FLOCK_BUSY=1.
cat > "$T/bin/flock" <<'EOF'
#!/usr/bin/env bash
[ "${FLOCK_BUSY:-0}" = 1 ] && exit 1
exit 0
EOF
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH"

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
reset() { : > "$SHIM_LOG"; rm -f "$MARKER"; unset ANSIBLE_FAIL_STACK FLOCK_BUSY GIT_UNKNOWN_SHA SSH_ORIGINAL_COMMAND; }
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
run "github hotfix reason goes through a file" 0 -- from_github "prod $SHA --hotfix \"fix: login, see 12/a.b\""
has "$SHIM_LOG" 'extra-vars-file: {"hotfix_reason": "fix: login, see 12/a.b"}' "reason is in the vars file"
hasnt "$SHIM_LOG" "hotfix_reason=" "reason is not on the command line"

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
if [ "$order" = "edge ops prod staging demo " ]; then ok "all order edge ops prod staging demo"; else bad "all order: $order"; fi
has "$SHIM_LOG" 'extra-vars-file: {"hotfix_reason": "first deploy"}' "empty prod log gets the first-deploy hotfix"
reset
echo "x prod $SHA ok" > "$BIDDALOY_ROOT/prod/deploys.log"
echo prod > "$BIDDALOY_ROOT/host-groups"
run "all without the ops group skips ops" 0 -- bash "$DEPLOY" all "$SHA"
order=$(grep '^ansible' "$SHIM_LOG" | sed -E 's/.*stack=([a-z]+) .*/\1/' | tr '\n' ' ')
if [ "$order" = "edge prod staging demo " ]; then ok "all skips ops"; else bad "all skips ops: $order"; fi
hasnt "$SHIM_LOG" "hotfix_reason" "no first-deploy hotfix when prod has a log line"
reset
ANSIBLE_FAIL_STACK=prod run "all stops at the first failure" 1 -- bash "$DEPLOY" all "$SHA"
order=$(grep '^ansible' "$SHIM_LOG" | sed -E 's/.*stack=([a-z]+) .*/\1/' | tr '\n' ' ')
if [ "$order" = "edge prod " ]; then ok "nothing after the failed stack ran"; else bad "after failure: $order"; fi
has "$T/out" "FAILED at: ansible deploy prod" "ansible failure block"
has "$T/out" "Why: ansible-playbook exited 2" "ansible failure why"
has "$T/out" "Next: read" "ansible failure next"
has "$BIDDALOY_ROOT/prod/last-deploy.log" "TASK failed" "output teed to last-deploy.log"

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

echo "-- $pass passed, $fail failed"
[ "$fail" = 0 ]
