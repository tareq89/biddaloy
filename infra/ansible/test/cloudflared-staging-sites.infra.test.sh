#!/usr/bin/env bash
# [Epic 40, #3715] Staging school sites need an Access rule that cloudflared really matches.
# cloudflared only understands a leading "*." wildcard, so "*-staging.<root>" matched nothing and
# the host fell to the catch-all with no Access check. This renders the real template (ansible) and
# asks the PINNED cloudflared image (the one deploy/edge.yml runs) which rule a host hits:
#   - a host on STAGING_SITE_HOSTS must hit a rule naming exactly that host
#   - a -staging host NOT on the list must hit the catch-all (no hostname); nginx then answers 444
#     (nginx/test/site.infra.test.sh)
# Needs ansible-playbook and docker. Run: bash cloudflared-staging-sites.infra.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
command -v ansible-playbook >/dev/null || { echo "skip: ansible-playbook not installed"; exit 0; }
command -v docker >/dev/null || { echo "skip: docker not installed"; exit 0; }
img=$(grep -oE 'cloudflare/cloudflared:[^[:space:]]+' "$repo/deploy/edge.yml" | head -1)
[ -n "$img" ] || { echo "FAIL no cloudflared image found in deploy/edge.yml"; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0
ROOT=schools.test

render() { # <out file> <STAGING_SITE_HOSTS value>
  cat >"$work/play.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  become: false
  vars:
    tunnel_id: 00000000-0000-0000-0000-000000000000
    cf_access_team: team.example
    aud_staging: aud-staging-tag
    aud_ops: aud-ops-tag
    secret_env:
      edge:
        APP_DOMAIN: app.$ROOT
        STAGING_DOMAIN: staging.$ROOT
        DEMO_DOMAIN: demo.$ROOT
        LANDING_DOMAIN: $ROOT
        KUMA_DOMAIN: kuma.$ROOT
        BESZEL_DOMAIN: beszel.$ROOT
        LOGS_DOMAIN: logs.$ROOT
        INBOX_DEMO_DOMAIN: inbox-demo.$ROOT
        INBOX_STAGING_DOMAIN: inbox-staging.$ROOT
        ROOT_DOMAIN: $ROOT
        STAGING_SITE_HOSTS: '$2'
  tasks:
    - ansible.builtin.template:
        src: '$repo/infra/ansible/templates/cloudflared-config.yml.j2'
        dest: '$1'
EOF
  ansible-playbook -c local -i localhost, "$work/play.yml" >"$work/ansible.txt" 2>&1 \
    || { echo "FAIL ansible could not render the template"; cat "$work/ansible.txt"; exit 1; }
}

rule() { # <host>: what cloudflared says about https://<host>
  docker run --rm -v "$work/c.yml:/c.yml:ro" "$img" tunnel --config /c.yml ingress rule "https://$1" 2>&1
}

check() { # <label> <host> <regex that must match> <regex that must NOT match>
  out=$(rule "$2")
  if grep -qE -- "$3" <<<"$out" && ! grep -qE -- "$4" <<<"$out"; then
    echo "ok   $1"
  else
    echo "FAIL $1"; echo "$out"; fails=$((fails + 1))
  fi
}

render "$work/c.yml" "model-school-staging.$ROOT other-school-staging.$ROOT"
check "listed staging host hits its own rule" "model-school-staging.$ROOT" "hostname: model-school-staging\\.schools\\.test" "XXXX"
check "second listed host hits its own rule" "other-school-staging.$ROOT" "hostname: other-school-staging\\.schools\\.test" "XXXX"
check "unlisted staging host falls to the catch-all (nginx 444s it)" "new-school-staging.$ROOT" "service: http://nginx:8081" "hostname:"
check "fixed staging host keeps its Access rule" "staging.$ROOT" "hostname: staging\\.schools\\.test" "XXXX"

render "$work/c.yml" ""
check "empty list: no staging school host has a rule" "model-school-staging.$ROOT" "service: http://nginx:8081" "hostname:"

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
