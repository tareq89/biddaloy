#!/usr/bin/env bash
# write-env.yml's staging derived values (Epic 88 U1): the app runs on the active db from
# <staging dir>/active-db (missing = dev), with that db's bucket and badge. Prod never gets a badge.
# No root, no Docker: the vars and the assert are read out of write-env.yml and rendered by ansible.
# Needs ansible-playbook. Run: bash staging-active-db.infra.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v ansible-playbook >/dev/null || { echo "skip: ansible-playbook not installed"; exit 0; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0

# The task vars come out as raw template text; copied to .j2 files, the template lookup renders
# them (the same trick as app-services.infra.test.sh). Each value is rendered on its own, in order.
cat > "$work/play.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  become: false
  tasks:
    - ansible.builtin.set_fact:
        tv: "{{ (lookup('ansible.builtin.file', '$here/../tasks/write-env.yml') | from_yaml)[0].vars }}"
        var_names: [staging_dir, staging_active_raw_v, staging_active_db, staging_s3_base, staging_bucket_active, staging_bucket_other_v, staging_loaded_raw]
    - ansible.builtin.copy:
        dest: '$work/var_{{ item }}.j2'
        content: '{{ tv[item] }}'
      check_mode: false
      loop: "{{ var_names }}"
    - ansible.builtin.copy:
        dest: '$work/v_{{ item.key }}.j2'
        content: '{{ item.value }}'
      check_mode: false
      loop: "{{ tv.derived_by_stack[stack] | dict2items }}"
    - ansible.builtin.set_fact:
        tvars: "{{ tvars | default({}) | combine({item: lookup('ansible.builtin.template', '$work/var_' ~ item ~ '.j2', template_vars=tvars | default({})) | trim}) }}"
      loop: "{{ var_names }}"
    - ansible.builtin.copy:
        dest: '$work/assert.j2'
        content: '{{ "{{ " ~ assert_that ~ " }}" }}'
      vars:
        assert_that: "{{ (lookup('ansible.builtin.file', '$here/../tasks/write-env.yml') | from_yaml)[1]['ansible.builtin.assert'].that }}"
      check_mode: false
    - ansible.builtin.debug:
        msg: "ASSERT=[{{ lookup('ansible.builtin.template', '$work/assert.j2', template_vars=tvars | combine({'staging_active_raw': tvars.staging_active_raw_v})) | trim }}]"
    - ansible.builtin.debug:
        msg: "OTHER=[{{ tvars.staging_bucket_other_v }}]"
    - ansible.builtin.debug:
        msg: "{{ item.key }}=[{{ lookup('ansible.builtin.template', '$work/v_' ~ item.key ~ '.j2', template_vars=tvars) | trim }}]"
      loop: "{{ tv.derived_by_stack[stack] | dict2items }}"
EOF

# \$1 state dir, \$2 stack (default staging), \$3 extra vars JSON (default none)
run() {
  ansible-playbook -c local -i localhost, "$work/play.yml" -e "staging_state_dir=$1" -e "stack=${2:-staging}" \
    -e "project_dir=/p" -e "version=v1" -e "${3:-{\}}" > "$work/out.txt" 2>&1 \
    || { echo "FAIL ansible-playbook failed"; cat "$work/out.txt"; fails=$((fails + 1)); }
}
want() { # <label> <regex>
  if grep -qE -- "$2" "$work/out.txt"; then echo "ok   $1"; else echo "FAIL $1 (wanted /$2/)"; fails=$((fails + 1)); fi
}
nowant() { # <label> <regex>
  if grep -qE -- "$2" "$work/out.txt"; then echo "FAIL $1 (found /$2/)"; fails=$((fails + 1)); else echo "ok   $1"; fi
}

mkdir "$work/none" "$work/dev" "$work/stg" "$work/bad" "$work/case" "$work/baddate"
echo dev > "$work/dev/active-db"
printf 'staging\n' > "$work/stg/active-db"
echo 2026-10-28 > "$work/stg/loaded-backup"
echo prod > "$work/bad/active-db"
echo Staging > "$work/case/active-db"
echo dev > "$work/baddate/active-db"
echo "x'; DROP" > "$work/baddate/loaded-backup"
secret='{"secret_env":{"staging":{"S3_BUCKET":"biddaloy-staging"}}}'

run "$work/none"
want "missing active-db is dev" 'POSTGRES_DB=\[biddaloy_staging_dev\]'
want "dev bucket" 'S3_BUCKET=\[biddaloy-dev\]'
want "dev badge" 'ENV_BADGE=\[DEV\]'
want "no loaded-backup gives empty badge date" 'ENV_BADGE_DATE=\[\]'
want "staging PG_MEM 1536m" 'PG_MEM=\[1536m\]'
want "missing file passes the assert" 'ASSERT=\[True\]'
want "dev: other bucket is the staging one" 'OTHER=\[biddaloy\]'

run "$work/dev"
want "dev file is dev" 'POSTGRES_DB=\[biddaloy_staging_dev\]'

run "$work/stg"
want "staging db" 'POSTGRES_DB=\[biddaloy_staging\]'
want "staging bucket" 'S3_BUCKET=\[biddaloy\]'
want "staging badge" 'ENV_BADGE=\[STAGING\]'
want "badge date from loaded-backup" 'ENV_BADGE_DATE=\[2026-10-28\]'
want "staging: other bucket is the dev one" 'OTHER=\[biddaloy-dev\]'

# The real secret base: staging keeps the secret's bucket as is; dev suffixes it.
run "$work/stg" staging "$secret"
want "secret base, staging: bucket as-is" 'S3_BUCKET=\[biddaloy-staging\]'
want "secret base, staging: other is -dev" 'OTHER=\[biddaloy-staging-dev\]'
run "$work/dev" staging "$secret"
want "secret base, dev: <base>-dev" 'S3_BUCKET=\[biddaloy-staging-dev\]'
want "secret base, dev: other is the secret bucket" 'OTHER=\[biddaloy-staging\]'

# Anything but exactly dev|staging fails the assert (no case folding).
run "$work/bad"
want "active-db=prod fails the assert" 'ASSERT=\[False\]'
run "$work/case"
want "active-db=Staging fails the assert" 'ASSERT=\[False\]'

# A badge date that is not YYYY-MM-DD is dropped.
run "$work/baddate"
want "bad loaded-backup gives empty badge date" 'ENV_BADGE_DATE=\[\]'

# Prod and demo: no badge, no db or bucket override.
for other in prod demo; do
  run "$work/stg" "$other"
  nowant "$other never gets ENV_BADGE" 'ENV_BADGE'
  nowant "$other never overrides POSTGRES_DB" 'POSTGRES_DB'
done

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
