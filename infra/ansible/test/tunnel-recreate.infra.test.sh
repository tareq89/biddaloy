#!/usr/bin/env bash
# deploy.yml's `tunnel_files_changed`: an edge deploy recreates cloudflared only when write-env
# changed the tunnel config or credentials (cloudflared reads them only at start, so a new
# hostname 404'd until a hand restart). Not on every deploy: the tunnel, prod included, drops.
# No root, no Docker: the expression is read out of deploy.yml and rendered by ansible itself.
# Needs ansible-playbook. Run: bash tunnel-recreate.infra.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v ansible-playbook >/dev/null || { echo "skip: ansible-playbook not installed"; exit 0; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0

# Each case passes the two registered results write-env would leave (or none, for app stacks).
cat > "$work/play.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  become: false
  vars:
    changed: { changed: true }
    same: { changed: false }
    skipped: { changed: false, skipped: true }
    cases:
      none: {}
      config: { cloudflared_config: '{{ changed }}', cloudflared_credentials: '{{ same }}' }
      creds: { cloudflared_config: '{{ same }}', cloudflared_credentials: '{{ changed }}' }
      neither: { cloudflared_config: '{{ same }}', cloudflared_credentials: '{{ same }}' }
      direct: { cloudflared_config: '{{ skipped }}', cloudflared_credentials: '{{ skipped }}' }
  tasks:
    - ansible.builtin.set_fact:
        deploy_vars: "{{ (lookup('ansible.builtin.file', '$here/../deploy.yml') | from_yaml)[0].vars }}"
    - ansible.builtin.copy:
        dest: '$work/changed.j2'
        content: '{{ deploy_vars.tunnel_files_changed }}'
      check_mode: false
    - ansible.builtin.debug:
        msg: "{{ item }}=[{{ lookup('ansible.builtin.template', '$work/changed.j2', template_vars=cases[item]) | trim }}]"
      loop: [none, config, creds, neither, direct]
EOF

ansible-playbook -c local -i localhost, "$work/play.yml" > "$work/out.txt" 2>&1 \
  || { echo "FAIL ansible-playbook failed"; cat "$work/out.txt"; exit 1; }
want() { # <label> <regex>
  if grep -qE -- "$2" "$work/out.txt"; then echo "ok   $1"; else echo "FAIL $1 (wanted /$2/)"; fails=$((fails + 1)); fi
}

want "app stack (nothing registered) does not recreate" "none=\[False\]"
want "new tunnel config recreates" "config=\[True\]"
want "new credentials recreate" "creds=\[True\]"
want "unchanged files leave the tunnel up" "neither=\[False\]"
want "direct mode (tasks skipped) does not recreate" "direct=\[False\]"

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
