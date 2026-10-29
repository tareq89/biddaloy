#!/usr/bin/env bash
# The deploy user's authorized_keys (group_vars/all.yml deploy_authorized_keys, Epic 88 D6-B): the
# operator key(s), GitHub's deploy key forced to biddaloy-deploy, and a SEPARATE staging key forced to
# biddaloy-staging. Each GitHub key only when it is set and not an UNSET placeholder. The provision
# assert refuses a key with options and one key used for both lines.
# No root, no host: group_vars is loaded into a local play and the file content is rendered the way
# provision.yml writes it. Needs ansible-playbook. Run: bash authorized-keys.infra.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v ansible-playbook >/dev/null || { echo "skip: ansible-playbook not installed"; exit 0; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0

OP='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOPERATOROPERATOROPERATOROPERATOROPERAT op@laptop'
DEP='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDEPLOYDEPLOYDEPLOYDEPLOYDEPLOYDEPLOYD biddaloy-github-deploy'
STG='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISTAGINGSTAGINGSTAGINGSTAGINGSTAGINGST biddaloy-github-staging'
DEP_LINE="command=\"/usr/local/bin/biddaloy-deploy --from-github\",restrict $DEP"
STG_LINE="command=\"/usr/local/bin/biddaloy-staging --from-github\",restrict $STG"

# The GitHub-key checks of provision.yml's "Supported inputs" assert (the ones naming a pubkey) are
# copied into .j2 files and rendered with the group_vars in scope.
cat > "$work/play.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  become: false
  vars_files: ['$here/../group_vars/all.yml']
  tasks:
    - ansible.builtin.copy:
        dest: '$work/authorized_keys'
        content: "{{ deploy_authorized_keys | join('\n') }}\n"
      check_mode: false
    - ansible.builtin.set_fact:
        key_checks: "{{ (lookup('ansible.builtin.file', '$here/../provision.yml') | from_yaml)[0].pre_tasks[0]['ansible.builtin.assert'].that | select('search', 'pubkey') | list }}"
    - ansible.builtin.copy:
        dest: '$work/check{{ idx }}.j2'
        content: '{{ "{{ " ~ item ~ " }}" }}'
      loop: '{{ key_checks }}'
      loop_control: { index_var: idx }
      check_mode: false
    - ansible.builtin.copy:
        dest: '$work/asserts'
        content: "{% for i in range(key_checks | length) %}{{ lookup('ansible.builtin.template', '$work/check' ~ i ~ '.j2') | trim }}\n{% endfor %}"
      check_mode: false
EOF

# run <deploy pubkey env> <staging pubkey env>; the pins are UNSET placeholders, as in a fresh inventory
run() {
  rm -f "$work/authorized_keys" "$work/asserts"
  env BIDDALOY_GITHUB_DEPLOY_PUBKEY="$1" BIDDALOY_GITHUB_STAGING_PUBKEY="$2" \
    ansible-playbook -c local -i localhost, "$work/play.yml" -e "operator_ssh_pubkey='$OP'" \
    -e github_deploy_pubkey_pinned=UNSET-deploy -e github_staging_pubkey_pinned=UNSET-staging > "$work/out.txt" 2>&1 \
    || { echo "FAIL ansible-playbook failed"; cat "$work/out.txt"; fails=$((fails + 1)); }
}
check() { # <label> <command...>
  if "${@:2}"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi
}
line() { grep -qFx -- "$1" "$work/authorized_keys"; }
none() { ! grep -qF -- "$1" "$work/authorized_keys"; }
# the line holding the staging key's base64 never names biddaloy-deploy
staging_never_deploys() { ! grep -F -- "${STG#ssh-ed25519 }" "$work/authorized_keys" | grep -q biddaloy-deploy; }
lines() { [ "$(grep -c . "$work/authorized_keys")" = "$1" ]; }
asserts_all() { [ "$(sort -u "$work/asserts" | tr -d '\n')" = "$1" ]; }

run "" ""
check "both UNSET: operator line only" lines 1
check "both UNSET: it is the operator key" line "$OP"
check "both UNSET: provision asserts pass" asserts_all True

run "$DEP" ""
check "deploy only: two lines" lines 2
check "deploy only: deploy key forced to biddaloy-deploy" line "$DEP_LINE"
check "deploy only: no biddaloy-staging line" none biddaloy-staging

run "" "$STG"
check "staging only: two lines" lines 2
check "staging only: staging key forced to biddaloy-staging --from-github, restrict" line "$STG_LINE"
check "staging only: nothing can deploy" none biddaloy-deploy

run "$DEP" "$STG"
check "both: three lines" lines 3
check "both: operator line" line "$OP"
check "both: deploy line" line "$DEP_LINE"
check "both: staging line" line "$STG_LINE"
check "both: the staging key never gets the deploy command" staging_never_deploys
check "both: provision asserts pass" asserts_all True

run "$DEP" "UNSET-paste-me"
check "staging UNSET placeholder: no staging line" lines 2

run "$DEP" "command=\"/bin/sh\" $STG"
check "staging key with options: provision assert fails" grep -qx False "$work/asserts"

run "$DEP" "${DEP% *} other-comment"
check "same key for deploy and staging: provision assert fails" grep -qx False "$work/asserts"

if [ "$fails" -ne 0 ]; then echo "$fails failed"; exit 1; fi
echo "all passed"
