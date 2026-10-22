#!/usr/bin/env bash
# tasks/report.yml (and, case 8, tasks/smoke-gate.yml) with a forced failure: the three-line FAILED block is printed and the
# deploys.log line is written. No root, no Docker, no network: a throwaway directory stands in
# for /opt/biddaloy/<stack>, and no secrets are loaded, so Telegram is skipped.
# The hotfix reason comes from BIDDALOY_HOTFIX_REASON, as in deploy.yml.
# Needs ansible-playbook (ansible-core 2.18.6, see group_vars/all.yml). Run: bash report.infra.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v ansible-playbook >/dev/null || { echo "skip: ansible-playbook not installed"; exit 0; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sha=0123456789abcdef0123456789abcdef01234567
fails=0
check() { if grep -qE -- "$2" "$3"; then echo "ok   $1"; else echo "FAIL $1 (wanted /$2/)"; fails=$((fails + 1)); fi; }

# become: false, because infra/ansible/ansible.cfg turns it on and this needs no root.
cat > "$work/play.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  become: false
  vars:
    stacks: [prod, staging, demo, edge, ops]
    deploy_user: nobody
    log_chown: false
    project_dir: $work/prod
    hotfix_note: "{{ lookup('ansible.builtin.env', 'BIDDALOY_HOTFIX_REASON') }}"
  tasks:
    - ansible.builtin.include_tasks: $here/../tasks/report.yml
EOF
mkdir -p "$work/prod"

# \$1 is JSON (values may hold spaces); \$2 is the hotfix reason.
run() { BIDDALOY_HOTFIX_REASON="${2-}" ansible-playbook -c local -i localhost, "$work/play.yml" -e "$1" > "$work/out.txt" 2>&1; }
count() { wc -l < "$work/prod/deploys.log" | tr -d ' '; }

# 1. a failure with a hotfix reason
run '{"stack":"prod","version":"'$sha'","deploy_status":"failed","fail_step":"migrate","fail_why":"relation fee_items does not exist","fail_next":"docker compose -p prod logs app"}' "login broken"
check "prints the FAILED line" 'FAILED at: migrate \(prod, 0123456789ab\)' "$work/out.txt"
check "prints the Why line" 'Why:       relation fee_items' "$work/out.txt"
check "prints the Next line" 'Next:      docker compose -p prod logs app' "$work/out.txt"
check "log line carries status and reason" "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z prod $sha failed hotfix: login broken\$" "$work/prod/deploys.log"
# The Deploy workflow's summary grep (.github/workflows/deploy.yml) finds the block as printed.
grep -E -A2 'FAILED at:' "$work/out.txt" > "$work/summary.txt"
check "workflow summary grep gets the Next line" 'Next: ' "$work/summary.txt"

# 2. a success prints no FAILED block and the prod gate can read it
run '{"stack":"staging","version":"'$sha'","deploy_status":"ok"}' ""
if grep -q 'FAILED at' "$work/out.txt"; then echo "FAIL ok result printed a FAILED block"; fails=$((fails + 1)); else echo "ok   no FAILED block on success"; fi
check "ok line matches the prod gate" " staging $sha ok\$" "$work/prod/deploys.log"

# 3. control characters (also a trailing newline) are not written: they could forge a log line
run '{"stack":"prod","version":"'$sha'","deploy_status":"failed","fail_step":"inputs","fail_why":"bad","fail_next":"none"}' $'x\n2026 prod y ok'
if [ "$(count)" = 3 ] && ! grep -q 'prod y ok' "$work/prod/deploys.log"; then echo "ok   unsafe hotfix reason left out"; else echo "FAIL unsafe hotfix reason forged a line"; fails=$((fails + 1)); fi
run '{"stack":"prod","version":"'$sha'","deploy_status":"failed","fail_step":"inputs","fail_why":"bad","fail_next":"none"}' $'reason\n'
if ! tail -n1 "$work/prod/deploys.log" | grep -q 'hotfix:'; then echo "ok   trailing newline left out"; else echo "FAIL trailing newline accepted"; fails=$((fails + 1)); fi

# 4. a blank reason is no reason
run '{"stack":"prod","version":"'$sha'","deploy_status":"failed","fail_step":"inputs","fail_why":"bad","fail_next":"none"}' "   "
if ! tail -n1 "$work/prod/deploys.log" | grep -q 'hotfix:'; then echo "ok   blank reason not logged"; else echo "FAIL blank reason logged"; fails=$((fails + 1)); fi

# 5. Jinja in the reason is data, not code
run '{"stack":"prod","version":"'$sha'","deploy_status":"failed","fail_step":"inputs","fail_why":"bad","fail_next":"none"}' "{{ lookup('pipe','echo PWNED') }}"
if ! grep -q 'PWNED$' "$work/prod/deploys.log"; then echo "ok   reason is not templated"; else echo "FAIL reason was executed"; fails=$((fails + 1)); fi

# 7. a first deploy whose login smoke was skipped: loud warning, note on the line, gate still reads it
run '{"stack":"staging","version":"'$sha'","deploy_status":"ok","smoke_login_skipped":true}' ""
check "skipped login smoke prints a WARNING" 'WARNING: smoke login checks SKIPPED for staging' "$work/out.txt"
check "skipped login smoke is noted on the log line" " staging $sha ok note: smoke-login-skipped\$" "$work/prod/deploys.log"
if tail -n1 "$work/prod/deploys.log" | grep -Eq " staging $sha ok"; then echo "ok   the prod gate still reads the noted line"; else echo "FAIL noted line breaks the prod gate"; fails=$((fails + 1)); fi

# 6. an unknown stack writes no log
before=$(count)
run '{"stack":"nope","version":"'$sha'","deploy_status":"failed","fail_step":"inputs","fail_why":"bad","fail_next":"none"}' ""
if [ "$(count)" = "$before" ]; then echo "ok   unknown stack writes no log line"; else echo "FAIL unknown stack wrote a log line"; fails=$((fails + 1)); fi

# 8. tasks/smoke-gate.yml: the login smoke is skipped only on a database that never had a user.
# A migration that empties a populated users table (before > 0, after 0) must NOT skip it.
cat > "$work/gate.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  become: false
  tasks:
    - ansible.builtin.include_tasks: $here/../tasks/smoke-gate.yml
    - ansible.builtin.debug:
        msg: 'GATE={{ smoke_login_skipped | bool }}'
EOF
gate() { # gate <stack> <before> <after> <want True|False> <desc>
  ansible-playbook -c local -i localhost, "$work/gate.yml" \
    -e "{\"stack\":\"$1\",\"db_users_before\":\"$2\",\"db_users_after\":\"$3\"}" > "$work/gate.txt" 2>&1
  if grep -q "GATE=$4" "$work/gate.txt"; then echo "ok   $5"; else echo "FAIL $5"; cat "$work/gate.txt"; fails=$((fails + 1)); fi
}
gate staging 0 0 True "gate: fresh database (0 before, 0 after) skips the login smoke"
gate prod 0 0 True "gate: fresh prod skips too"
gate staging 5 0 False "gate: a migration that emptied users does not skip"
gate prod 12 0 False "gate: same on prod"
gate staging 0 3 False "gate: users appeared, login smoke runs"
gate staging '' 0 False "gate: unknown before-count never skips"
gate staging 0 'x' False "gate: unreadable after-count never skips"
gate demo 0 0 False "gate: demo never takes the login path"

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
