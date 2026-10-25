#!/usr/bin/env bash
# Integration test for backup.sh: runs the real script against a local
# seaweedfs + db from docker-compose (started by this script if not already
# up), then asserts:
#   1. exactly one new object lands under backups/db/ with a .dump.age suffix
#   2. that object decrypts with the matching age private key
#   3. the decrypted bytes are a valid pg_dump custom-format archive
#      (pg_restore --list succeeds on it)
#
# `--shim` runs only the Docker-free PATH-shim cases (fake aws/rclone/curl/
# pg_dump/age; BACKUP_NOW fakes the clock).
#
# Requires docker, docker compose, age, and either a local aws-cli or the
# `amazon/aws-cli` image (used via docker run below to avoid a host
# dependency). Not run by `yarn test` — it needs live docker compose
# services, so it's invoked separately, e.g. in CI or by hand:
#
#   scripts/backup/backup.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------
# Shim cases: no Docker. Fake aws/rclone/curl/pg_dump/age on PATH log every
# call to $SHIM/log; backup.sh runs for real against them with BACKUP_NOW
# fixing the clock. Run only these with: backup.test.sh --shim
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIM="$(mktemp -d)"
trap 'rm -rf "$SHIM" "${WORKDIR:-}"' EXIT
mkdir -p "$SHIM/bin" "$SHIM/lists"
cat >"$SHIM/bin/aws" <<'EOS'
#!/usr/bin/env bash
echo "aws $*" >>"$SHIM/log"
[[ "$1" == --endpoint-url ]] && shift 2
if [[ "$1 $2" == "s3api list-objects-v2" ]]; then
  prefix=""; newest=0; while [[ $# -gt 0 ]]; do [[ "$1" == "--prefix" ]] && prefix="$2"; [[ "$1" == *sort_by* ]] && newest=1; shift; done
  f="$SHIM/lists/$(echo "$prefix" | tr '/' '_')"
  [[ -z "$prefix" ]] && f="$SHIM/lists/_live"
  if [[ ! -f "$f" ]]; then echo None; elif [[ $newest == 1 ]]; then tail -n1 "$f"; else cat "$f"; fi
elif [[ "$1 $2" == "s3 rm" && "${AWS_FAIL_RM:-}" == 1 ]]; then exit 1
elif [[ "$*" == *" - s3://"* ]]; then cat >/dev/null
elif [[ "$1 $2" == "s3 cp" ]]; then
  last="${*: -1}"
  if [[ "$last" == "-" ]]; then cat "$SHIM/livefile"; elif [[ "$last" != s3://* ]]; then echo bytes >"$last"; fi
fi
exit 0
EOS
cat >"$SHIM/bin/rclone" <<'EOS'
#!/usr/bin/env bash
echo "rclone $*" >>"$SHIM/log"
case "$1" in
  obscure) cat >/dev/null; echo "obscured" ;;
  cat) if [[ "${RCLONE_BAD:-}" == 1 ]]; then echo different; else cat "$SHIM/livefile"; fi ;;
  sync)
    echo "confperm $(ls -l "$RCLONE_CONFIG" | cut -c1-10)" >>"$SHIM/log"
    echo "confnocheck $(grep -c 'no_check_bucket = true' "$RCLONE_CONFIG")" >>"$SHIM/log"
    [[ "${RCLONE_DRY_FAIL:-}" == 1 && "$*" == *--dry-run* ]] && exit 7
    [[ "${RCLONE_FAIL:-}" == 1 ]] && exit 1 ;;
  lsf)
    case "$*" in
      *files-trash*) [[ -f "$SHIM/trash3" ]] && exit 3; [[ -f "$SHIM/trash" ]] && cat "$SHIM/trash" ;;
      *src:*) if [[ -f "$SHIM/srclist" ]]; then cat "$SHIM/srclist"; else echo "tenants/"; fi ;;
      *) [[ -f "$SHIM/dstlist" ]] && cat "$SHIM/dstlist" ;;
    esac ;;
esac
exit 0
EOS
cat >"$SHIM/bin/curl" <<'EOS'
#!/usr/bin/env bash
echo "curl $*" >>"$SHIM/log"; [[ "$*" != *http_code* ]] || printf '%s' "${CURL_CODE:-200}"; exit 0
EOS
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\n[[ "${PG_FAIL:-}" == 1 ]] && exit 1\necho dump\n' >"$SHIM/bin/pg_dump"
cat >"$SHIM/bin/age" <<'EOS'
#!/usr/bin/env bash
if [[ "$1" == "--decrypt" ]]; then
  while [[ $# -gt 0 ]]; do [[ "$1" == "-o" ]] && echo dump >"$2"; shift; done
  exit 0
fi
cat
EOS
cat >"$SHIM/bin/pg_restore" <<'EOS'
#!/usr/bin/env bash
echo "pg_restore $*" >>"$SHIM/log"
[[ "${RESTORE_FAIL:-}" == 1 ]] && exit 1
exit 0
EOS
cat >"$SHIM/bin/psql" <<'EOS'
#!/usr/bin/env bash
echo "psql $*" >>"$SHIM/log"
if [[ "$*" == *" -f "* ]]; then
  cat "$SHIM/live.csv"
fi
[[ "$*" == *pg_database_size* ]] && echo "${DB_BYTES:-1000}"
# DROP_FAIL=1: only the cleanup drop fails (the one after CREATE DATABASE).
if [[ "${DROP_FAIL:-}" == 1 && "$*" == *"DROP DATABASE"* ]] && grep -q "CREATE DATABASE" "$SHIM/log"; then exit 1; fi
exit 0
EOS
# macOS has no flock; the lock itself is not under test here.
printf '#!/bin/sh\nexit 0\n' >"$SHIM/bin/flock"
chmod +x "$SHIM"/bin/*

# run_shim [VAR=value ...]: runs backup.sh in R2 mode with the given overrides.
run_shim() {
  : >"$SHIM/log"
  env -i PATH="$SHIM/bin:$PATH" SHIM="$SHIM" HOME="$SHIM" \
    DATABASE_URL=postgres://u:p@h/d BACKUP_AGE_PUBLIC_KEY=age1x \
    S3_BUCKET=src S3_ENDPOINT=http://seaweedfs:8333 S3_ALLOW_INSECURE_HTTP=true \
    S3_REGION=us-east-1 S3_ACCESS_KEY_ID=ak S3_SECRET_ACCESS_KEY=sk \
    BACKUP_S3_ENDPOINT=https://acct.r2.cloudflarestorage.com BACKUP_S3_BUCKET=r2b \
    BACKUP_S3_ACCESS_KEY_ID=rk BACKUP_S3_SECRET_ACCESS_KEY=r2-secret-0123456789 \
    BACKUP_RCLONE_CRYPT_PASSWORD=crypt-pass-0123456789 BACKUP_RCLONE_CRYPT_SALT=crypt-salt-0123456789 \
    BACKUP_PUSH_URL=https://kuma.example/api/push/tok BACKUP_NET_WAIT_SECS=0 \
    BACKUP_TEST_CLOCK_OK=1 BACKUP_NOW=2026-10-20T10:00:00Z "$@" bash "$SCRIPT_DIR/backup.sh" >"$SHIM/out" 2>&1
}
shim_fail() { echo "FAIL: $1" >&2; echo "--- log"; cat "$SHIM/log"; echo "--- out"; cat "$SHIM/out"; exit 1; }
has() { grep -q -- "$1" "$SHIM/log" || shim_fail "expected log to contain: $1"; }
hasnt() { if grep -q -- "$1" "$SHIM/log"; then shim_fail "log must not contain: $1"; fi; }

echo "backup.test.sh: shim cases"

# 1. hourly key shape; today's daily already there -> no daily copy; sync uses
#    --backup-dir on the same crypt remote; up push; token never printed.
echo "db/daily/2026-10-20.dump.age" >"$SHIM/lists/db_daily_2026-10-20.dump.age"
run_shim || shim_fail "plain run exited non-zero"
has "s3://r2b/db/hourly/20261020T100000Z.dump.age"
hasnt "s3 cp .*db/daily/"
# 10:00Z = 16:00 Dhaka -> trash suffix -160000.
sync_line="rclone sync src:src r2crypt:files --exclude /backups/\*\* --backup-dir r2crypt:files-trash/2026-10-20 --suffix -160000 --max-delete 500 --fast-list --transfers 8"
has "^$sync_line --dry-run -q$"
has "^$sync_line$"
has "confperm -rw-------"
has "confnocheck 1"
has "status=up&msg=ok"
if grep -q tok "$SHIM/out"; then shim_fail "push token leaked into output"; fi
echo "PASS: hourly key, sync --backup-dir --suffix --max-delete, 0600 config, up push, no token in output"
rm -f "$SHIM"/lists/*

# 2. daily copy from 02:00 Dhaka (= 20:00Z of the previous UTC day), catch-up
#    when missing, none before 02:00.
run_shim BACKUP_NOW=2026-10-19T20:05:00Z || shim_fail "02:00 run failed"
has "s3://r2b/db/hourly/20261019T200500Z.dump.age s3://r2b/db/daily/2026-10-20.dump.age"
run_shim || shim_fail "catch-up run failed"
has "s3://r2b/db/hourly/20261020T100000Z.dump.age s3://r2b/db/daily/2026-10-20.dump.age"
run_shim BACKUP_NOW=2026-10-19T19:05:00Z || shim_fail "01:00 run failed"
hasnt "s3 cp .*db/daily/"
echo "PASS: daily copy at/after 02:00 Dhaka (catch-up), none before"

# 2b. dump failure removes the partial hourly object and pushes down&msg=dump.
if run_shim PG_FAIL=1; then shim_fail "dump failure must exit non-zero"; fi
has "aws s3 rm .* s3://r2b/db/hourly/20261020T100000Z.dump.age"
has "status=down&msg=dump"
echo "PASS: failed dump cleans partial object"

# 2c. a push URL that already has a query is reduced to the bare URL.
run_shim BACKUP_PUSH_URL='https://kuma.example/api/push/tok?status=up&msg=OK&ping=' || shim_fail "push-url run failed"
has "tok?status=up&msg=ok"
hasnt "msg=OK"
echo "PASS: push URL query stripped"

# 2c2. a push answered with a redirect (Access login) or no 2xx is logged, token not printed.
run_shim CURL_CODE=302 || shim_fail "302-push run failed"
grep -q "Kuma push got HTTP 302, not 2xx" "$SHIM/out" || shim_fail "a 302 push was not logged"
if grep -q tok "$SHIM/out"; then shim_fail "push token leaked into output"; fi
run_shim
if grep -q "Kuma push got" "$SHIM/out"; then shim_fail "a 200 push must not be logged"; fi
echo "PASS: non-2xx push is logged, 2xx is quiet"

# 2d. config error pushes down&msg=config.
if run_shim BACKUP_HOURLY_KEEP=abc; then shim_fail "bad config must fail"; fi
has "status=down&msg=config"
if run_shim BACKUP_FILES_MAX_DELETE=0; then shim_fail "max-delete 0 must fail"; fi
has "status=down&msg=config"
run_shim BACKUP_FILES_MAX_DELETE=7 || shim_fail "custom max-delete run failed"
has "--max-delete 7 "
echo "PASS: config error pushes down; max-delete is configurable"

# 2e. a copied change-me placeholder or a short crypt secret is refused, by
#     backup.sh and by entrypoint.sh, before anything is synced; never echoed.
for bad in BACKUP_RCLONE_CRYPT_PASSWORD=change-me BACKUP_RCLONE_CRYPT_SALT=short-salt \
  BACKUP_S3_SECRET_ACCESS_KEY=change-me-0123456789; do
  if run_shim "$bad"; then shim_fail "placeholder must fail: ${bad%%=*}"; fi
  has "status=down&msg=config"; hasnt "rclone"
  grep -q "${bad%%=*} is a placeholder" "$SHIM/out" || shim_fail "no placeholder error for ${bad%%=*}"
  if grep -q -- "${bad#*=}" "$SHIM/out"; then shim_fail "placeholder value echoed"; fi
done
ep_out="$(env -i PATH="$PATH" DATABASE_URL=x BACKUP_AGE_PUBLIC_KEY=x S3_BUCKET=x S3_ENDPOINT=x \
  S3_REGION=x S3_ACCESS_KEY_ID=x S3_SECRET_ACCESS_KEY=x BACKUP_S3_ENDPOINT=https://x \
  BACKUP_S3_BUCKET=x BACKUP_S3_ACCESS_KEY_ID=x BACKUP_S3_SECRET_ACCESS_KEY=r2-secret-0123456789 \
  BACKUP_RCLONE_CRYPT_PASSWORD=change-me BACKUP_RCLONE_CRYPT_SALT=crypt-salt-0123456789 \
  bash "$SCRIPT_DIR/entrypoint.sh" 2>&1)" && shim_fail "entrypoint accepted a placeholder"
grep -q "BACKUP_RCLONE_CRYPT_PASSWORD is a placeholder" <<<"$ep_out" || shim_fail "entrypoint: no placeholder error: $ep_out"
echo "PASS: placeholder / short secrets rejected (backup.sh + entrypoint.sh)"

# 3. prune keeps exactly N newest by key (hourly + daily).
for i in 01 02 03 04 05; do echo "db/hourly/202610${i}T000000Z.dump.age"; done >"$SHIM/lists/db_hourly_"
for i in 01 02 03; do echo "db/daily/2026-09-${i}.dump.age"; done >"$SHIM/lists/db_daily_"
run_shim BACKUP_HOURLY_KEEP=2 BACKUP_DAILY_KEEP=1 || shim_fail "prune run failed"
for k in db/hourly/20261001T000000Z db/hourly/20261002T000000Z db/hourly/20261003T000000Z db/daily/2026-09-01 db/daily/2026-09-02; do has "aws s3 rm .* s3://r2b/$k.dump.age"; done
hasnt "rm .*20261004T000000Z"; hasnt "rm .*20261005T000000Z"; hasnt "rm .*2026-09-03"
echo "PASS: prune keeps newest N by key"
rm -f "$SHIM"/lists/*

# 3b. default retention: 105 hourly keys -> the oldest 5 go, newest 100 stay.
for i in $(seq 1 105); do printf 'db/hourly/2026%04dT000000Z.dump.age\n' "$i"; done >"$SHIM/lists/db_hourly_"
run_shim || shim_fail "default prune run failed"
for i in 1 2 3 4 5; do has "aws s3 rm .* s3://r2b/db/hourly/2026$(printf %04d $i)T000000Z.dump.age"; done
[[ "$(grep -c 'aws s3 rm .*db/hourly/' "$SHIM/log")" == 5 ]] || shim_fail "default prune must delete exactly 5"
echo "PASS: default hourly retention keeps newest 100"
rm -f "$SHIM"/lists/*

# 4. trash prune by folder date (cutoff 2026-09-20 for now=2026-10-20, 30 days).
printf '2026-09-19/\n2026-09-20/\n2026-10-19/\nnot-a-date/\n' >"$SHIM/trash"
run_shim || shim_fail "trash run failed"
has "rclone purge r2crypt:files-trash/2026-09-19"
hasnt "purge .*2026-09-20"; hasnt "purge .*2026-10-19"; hasnt "purge .*not-a-date"
echo "PASS: trash purge by faked date"
rm -f "$SHIM/trash"

# 4b. missing files-trash (rclone exit 3) is empty, not a failure.
: >"$SHIM/trash3"
run_shim || shim_fail "missing trash dir must not fail the run"
rm -f "$SHIM/trash3"
echo "PASS: lsf exit 3 treated as empty"

# 4c. a failed prune exits non-zero.
echo "db/hourly/20260101T000000Z.dump.age" >"$SHIM/lists/db_hourly_"
echo "db/hourly/20260102T000000Z.dump.age" >>"$SHIM/lists/db_hourly_"
if run_shim BACKUP_HOURLY_KEEP=1 AWS_FAIL_RM=1; then shim_fail "failed prune must exit non-zero"; fi
has "status=down&msg=prune-hourly"
rm -f "$SHIM"/lists/*
echo "PASS: failed prune exits non-zero"

# 4d. empty source + non-empty backup: refuse to sync.
: >"$SHIM/srclist"; echo "tenants/" >"$SHIM/dstlist"
if run_shim; then shim_fail "empty-source guard must fail"; fi
hasnt "rclone sync"
has "status=down&msg=files-sync"
rm -f "$SHIM/srclist" "$SHIM/dstlist"
echo "PASS: empty-source guard"

# 5. failing step -> down push naming the step, non-zero exit, no up push.
if run_shim RCLONE_FAIL=1; then shim_fail "files failure must exit non-zero"; fi
has "status=down&msg=files-sync"
hasnt "status=up"
echo "PASS: failing step pushes down and exits non-zero"

# 5a. the --max-delete dry run fails -> the real sync never runs, nothing moves.
if run_shim RCLONE_DRY_FAIL=1; then shim_fail "failed dry run must exit non-zero"; fi
has "--dry-run -q$"
hasnt "--transfers 8$"
has "status=down&msg=files-sync"
grep -q "refusing to sync" "$SHIM/out" || shim_fail "no refusal message"
echo "PASS: failed dry run skips the real sync"

# 5b. db prunes still run when the files sync fails (they come first).
echo "db/hourly/20260101T000000Z.dump.age" >"$SHIM/lists/db_hourly_"
echo "db/hourly/20260102T000000Z.dump.age" >>"$SHIM/lists/db_hourly_"
if run_shim RCLONE_FAIL=1 BACKUP_HOURLY_KEEP=1; then shim_fail "files failure must exit non-zero"; fi
has "aws s3 rm .* s3://r2b/db/hourly/20260101T000000Z.dump.age"
rm -f "$SHIM"/lists/*
echo "PASS: db prune runs before a failing files sync"

# 6. BACKUP_S3_* unset -> legacy key, no rclone, no daily copy.
run_shim BACKUP_S3_ENDPOINT= BACKUP_S3_BUCKET= BACKUP_S3_ACCESS_KEY_ID= BACKUP_S3_SECRET_ACCESS_KEY= \
  BACKUP_RCLONE_CRYPT_PASSWORD= BACKUP_RCLONE_CRYPT_SALT= || shim_fail "legacy run failed"
has "s3://src/backups/db/20261020T100000Z.dump.age"
hasnt "rclone"; hasnt "s3 cp .*db/daily/"
echo "PASS: unset BACKUP_S3_* falls back to legacy path"

# 7. partial R2 config is rejected.
if run_shim BACKUP_RCLONE_CRYPT_SALT=; then shim_fail "partial R2 env must fail"; fi
echo "PASS: partial BACKUP_S3_* rejected"

# 8. real rclone (local backend, no network): the exact sync shape backup.sh
#    uses (crypt remote rooted at the bucket, --backup-dir on the same remote,
#    --suffix) must exit 0; two deletes of one path on one date keep both
#    trash copies; the dry-run-then-sync pair stops a broken source that
#    deletes more than --max-delete files, on every run, touching nothing.
if command -v rclone >/dev/null 2>&1; then
  RC="$SHIM/rc"; mkdir -p "$RC/src" "$RC/bucket"
  export RCLONE_CONFIG="$RC/rclone.conf"
  printf '[loc]\ntype = local\n\n[r2crypt]\ntype = crypt\nremote = loc:%s\nfilename_encryption = standard\npassword = %s\n' \
    "$RC/bucket" "$(printf '%s' pw | rclone obscure -)" >"$RCLONE_CONFIG"
  echo a >"$RC/src/a.txt"; echo b >"$RC/src/b.txt"
  # Same pair as backup.sh: a dry run with the same flags, then the real sync.
  rsync_() {
    local a=("$RC/src" r2crypt:files --backup-dir r2crypt:files-trash/2026-10-20 --suffix "$1" --max-delete "$2" --fast-list --transfers 8)
    rclone sync "${a[@]}" --dry-run -q 2>/dev/null && rclone sync "${a[@]}"
  }
  rsync_ -100000 500 || shim_fail "real rclone first sync failed"
  rm "$RC/src/a.txt"
  rsync_ -110000 500 || shim_fail "real rclone sync with deletion failed"
  echo a2 >"$RC/src/a.txt"; rsync_ -120000 500 || shim_fail "real rclone re-add failed"
  rm "$RC/src/a.txt"
  rsync_ -130000 500 || shim_fail "real rclone second deletion failed"
  [[ "$(rclone lsf --dirs-only r2crypt:files-trash)" == "2026-10-20/" ]] || shim_fail "trash date dir missing"
  [[ "$(rclone lsf r2crypt:files-trash/2026-10-20 | sort | tr '\n' ' ')" == "a.txt-110000 a.txt-130000 " ]] \
    || shim_fail "same-day trash copies collided: $(rclone lsf r2crypt:files-trash/2026-10-20)"
  rm "$RC/src/b.txt"
  if rsync_ -140000 0; then shim_fail "--max-delete 0 must stop a sync that deletes"; fi
  [[ -n "$(rclone lsf r2crypt:files)" ]] || shim_fail "--max-delete still deleted the file"
  # A plain sync would move 3 files per run (exit 7) and go green on run 3;
  # the dry run must keep all 10 in place across runs.
  rm -f "$RC"/src/*; for i in 0 1 2 3 4 5 6 7 8 9; do echo "$i" >"$RC/src/f$i"; done
  rsync_ -150000 500 || shim_fail "real rclone 10-file sync failed"
  rm "$RC"/src/f[0-7]
  for r in 1 2; do
    if rsync_ "-16000$r" 3; then shim_fail "run $r: 8 deletes passed --max-delete 3"; fi
    [[ "$(rclone lsf r2crypt:files | grep -c '^f')" == 10 ]] || shim_fail "run $r: files/ lost files"
  done
  if rclone lsf r2crypt:files-trash/2026-10-20 | grep -q '^f'; then shim_fail "dry run moved files to trash"; fi
  unset RCLONE_CONFIG
  echo "PASS: real rclone sync + --backup-dir + --suffix + --max-delete"
else
  echo "SKIP: real-rclone case (rclone not installed)"
fi

# D7. entrypoint writes only the backup crontab line (no drill, D5).
mkdir -p "$SHIM/app"
sed "s#/app/crontab#$SHIM/app/crontab#g; s#exec supercronic.*#cat $SHIM/app/crontab#" "$SCRIPT_DIR/entrypoint.sh" >"$SHIM/entry.sh"
EP=(env -i PATH="$PATH" BACKUP_S3_ENDPOINT=x BACKUP_S3_BUCKET=x BACKUP_S3_ACCESS_KEY_ID=x BACKUP_S3_SECRET_ACCESS_KEY=r2-secret-0123456789 BACKUP_RCLONE_CRYPT_PASSWORD=crypt-pass-0123456789 BACKUP_RCLONE_CRYPT_SALT=crypt-salt-0123456789 DATABASE_URL=x BACKUP_AGE_PUBLIC_KEY=x S3_BUCKET=x S3_ENDPOINT=x S3_REGION=x S3_ACCESS_KEY_ID=x S3_SECRET_ACCESS_KEY=x)
"${EP[@]}" bash "$SHIM/entry.sh" | grep -q '^0 \* \* \* \* /app/backup.sh$' || shim_fail "backup crontab line missing"
if "${EP[@]}" bash "$SHIM/entry.sh" | grep -q drill; then shim_fail "no drill line may be scheduled"; fi
echo "PASS: crontab has the backup line and no drill line"

if [[ "${1:-}" == "--shim" ]]; then
  echo "backup.test.sh: shim cases passed"
  exit 0
fi

# docker-compose.yml requires these (`${VAR:?...}`); same defaults as scripts/test-env.sh.
export APP_VERSION="${APP_VERSION:-local}"
export TLS_CERT_DIR="${TLS_CERT_DIR:-./.certs}"
export POSTGRES_USER="${POSTGRES_USER:-postgres}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
export POSTGRES_DB="${POSTGRES_DB:-biddaloy}"
export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-ci-access-key}"
export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-ci-secret-key}"

echo "backup.test.sh: bringing up db + seaweedfs"
docker compose up -d --wait db seaweedfs
docker compose exec -T db sh -c 'until pg_isready -U "$POSTGRES_USER"; do sleep 1; done' >/dev/null

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$SHIM" "$WORKDIR"' EXIT

echo "backup.test.sh: generating a throwaway age keypair"
age-keygen -o "$WORKDIR/key.txt" 2>"$WORKDIR/keygen.log"
AGE_PUBLIC_KEY="$(grep 'Public key:' "$WORKDIR/keygen.log" | sed 's/.*: //')"
AGE_PRIVATE_KEY="$(grep -v '^#' "$WORKDIR/key.txt")"

: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_PASSWORD:=change-me}"
: "${POSTGRES_DB:=biddaloy}"
: "${S3_ACCESS_KEY_ID:=change-me}"
: "${S3_SECRET_ACCESS_KEY:=change-me}"
: "${S3_BUCKET:=biddaloy}"

echo "backup.test.sh: running backup.sh"
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
BACKUP_AGE_PUBLIC_KEY="$AGE_PUBLIC_KEY" \
S3_ENDPOINT="http://127.0.0.1:9000" \
S3_ALLOW_INSECURE_HTTP="true" \
S3_REGION="us-east-1" \
S3_BUCKET="$S3_BUCKET" \
S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
BACKUP_RETENTION_DAYS=30 \
  bash "$(dirname "$0")/backup.sh"

echo "backup.test.sh: listing bucket for the uploaded object"
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=us-east-1

# Use the host `aws` CLI when present, otherwise fall back to the
# `amazon/aws-cli` image via `docker run` — this is the fallback the
# header comment above documents, so a host without `aws` installed
# doesn't just fail under `set -e` on the first S3 call.
aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    aws "$@"
  else
    docker run --rm --network host \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
      -v "$WORKDIR:$WORKDIR" \
      amazon/aws-cli "$@"
  fi
}

latest_key="$(aws_cli s3api list-objects-v2 \
  --endpoint-url http://127.0.0.1:9000 \
  --bucket "$S3_BUCKET" \
  --prefix "backups/db/" \
  --query 'sort_by(Contents, &LastModified)[-1].Key' \
  --output text)"

if [[ "$latest_key" != *.dump.age ]]; then
  echo "FAIL: expected a backups/db/*.dump.age object, got '$latest_key'" >&2
  exit 1
fi
echo "PASS: found $latest_key"

aws_cli s3 cp --endpoint-url http://127.0.0.1:9000 "s3://${S3_BUCKET}/${latest_key}" "$WORKDIR/backup.dump.age"

echo "backup.test.sh: decrypting with the matching private key"
age --decrypt -i <(echo "$AGE_PRIVATE_KEY") -o "$WORKDIR/backup.dump" "$WORKDIR/backup.dump.age"

echo "backup.test.sh: verifying the decrypted archive with pg_restore --list"
docker run --rm -v "$WORKDIR:/work" postgres:18-alpine pg_restore --list /work/backup.dump >/dev/null

echo "PASS: decrypted archive is a valid pg_dump custom-format dump"
