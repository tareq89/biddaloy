#!/usr/bin/env bash
# tasks/report.yml with a forced failure: the three-line FAILED block is printed and the
# deploys.log line is written. No root, no Docker, no network: a throwaway directory stands in
# for /opt/biddaloy/<stack>, and no secrets are loaded, so Telegram is skipped.
# Needs ansible-playbook (ansible-core 2.18.6, see group_vars/all.yml). Run: bash report.infra.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v ansible-playbook >/dev/null || { echo "skip: ansible-playbook not installed"; exit 0; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sha=0123456789abcdef0123456789abcdef01234567
fails=0
check() { if grep -qE -- "$2" "$3"; then echo "ok   $1"; else echo "FAIL $1 (wanted /$2/)"; fails=$((fails + 1)); fi; }

cat > "$work/play.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  vars:
    stacks: [prod, staging, demo, edge, ops]
    deploy_user: nobody
    log_chown: false
    project_dir: $work/prod
  tasks:
    - ansible.builtin.include_tasks: $here/../tasks/report.yml
EOF
mkdir -p "$work/prod"

run() { ansible-playbook -c local -i localhost, "$work/play.yml" -e "$1" > "$work/out.txt" 2>&1; }  # $1 is JSON: values may hold spaces

# 1. a failure with a hotfix reason
run '{"stack":"prod","version":"'$sha'","deploy_status":"failed","hotfix_reason":"login broken","fail_step":"migrate","fail_why":"relation fee_items does not exist","fail_next":"docker compose -p prod logs app"}'
check "prints the FAILED line" 'FAILED at: migrate \(prod, 0123456789ab\)' "$work/out.txt"
check "prints the Why line" 'Why:       relation fee_items' "$work/out.txt"
check "prints the Next line" 'Next:      docker compose -p prod logs app' "$work/out.txt"
check "log line carries status and reason" "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z prod $sha failed hotfix: login broken\$" "$work/prod/deploys.log"

# 2. a success prints no FAILED block and the prod gate can read it
run '{"stack":"staging","version":"'$sha'","deploy_status":"ok","hotfix_reason":""}'
if grep -q 'FAILED at' "$work/out.txt"; then echo "FAIL ok result printed a FAILED block"; fails=$((fails + 1)); else echo "ok   no FAILED block on success"; fi
check "ok line matches the prod gate" " staging $sha ok\$" "$work/prod/deploys.log"

# 3. a reason with a control character is not written (it could forge a log line)
run '{"stack":"prod","version":"'$sha'","deploy_status":"failed","hotfix_reason":"x\n2026 prod y ok","fail_step":"inputs","fail_why":"bad","fail_next":"none"}'
lines=$(wc -l < "$work/prod/deploys.log" | tr -d ' ')
if [ "$lines" = 3 ] && ! grep -q 'prod y ok' "$work/prod/deploys.log"; then echo "ok   unsafe hotfix reason left out"; else echo "FAIL unsafe hotfix reason forged a line"; fails=$((fails + 1)); fi

# 4. an unknown stack writes no log
run '{"stack":"nope","version":"'$sha'","deploy_status":"failed","hotfix_reason":"","fail_step":"inputs","fail_why":"bad","fail_next":"none"}'
lines=$(wc -l < "$work/prod/deploys.log" | tr -d ' ')
if [ "$lines" = 3 ]; then echo "ok   unknown stack writes no log line"; else echo "FAIL unknown stack wrote a log line"; fails=$((fails + 1)); fi

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
