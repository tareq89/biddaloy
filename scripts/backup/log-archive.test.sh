#!/usr/bin/env bash
# Test for log-archive.sh. Pure bash: `rclone` is a shim that treats a local folder as the
# encrypted remote (r2crypt:logs -> $WORK/remote/logs). No Docker, no network.
#
#   bash scripts/backup/log-archive.test.sh
#
# Cases: 1 copy + check ok, local export removed; 2 a 181-day-old prefix is deleted, a 179-day-old
# one is kept; 3 a failed check keeps the local files and deletes nothing; 4 bad date refused (2);
# 5 a missing export fails (1).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/log-archive.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/remote/logs"

# The shim maps r2crypt:logs[/x] to $WORK/remote/logs[/x].
cat > "$WORK/bin/rclone" <<'SHIM'
#!/usr/bin/env bash
map() { printf '%s' "${1/r2crypt:/$WORK/remote/}"; }
echo "rclone $*" >> "$WORK/calls.log"
case "$1" in
  obscure) cat ;;
  copy) mkdir -p "$(map "$3")" && cp -R "$2/." "$(map "$3")/" ;;
  check) [[ -z "${FAIL_CHECK:-}" ]] && diff -r "$2" "$(map "$3")" >/dev/null ;;
  lsf) for d in "$(map "$3")"/*/; do [[ -d "$d" ]] && printf '%s/\n' "$(basename "$d")"; done; true ;;
  purge) rm -rf "$(map "$2")" ;;
  *) echo "shim: unexpected $*" >&2; exit 9 ;;
esac
SHIM
chmod +x "$WORK/bin/rclone"
export PATH="$WORK/bin:$PATH" WORK

days_ago() {
  local t=$(($(date +%s) - $1 * 86400))
  date -d "@$t" +%F 2>/dev/null || date -r "$t" +%F
}

export LOG_ARCHIVE_EXPORT_DIR="$WORK/export"
export BACKUP_S3_ENDPOINT=https://example.invalid BACKUP_S3_BUCKET=b BACKUP_S3_ACCESS_KEY_ID=k \
  BACKUP_S3_SECRET_ACCESS_KEY=s BACKUP_RCLONE_CRYPT_PASSWORD=p BACKUP_RCLONE_CRYPT_SALT=t

fails=0
check() { if [[ "$2" == ok ]]; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
ran() { local rc=0; LOG_ARCHIVE_DATE="$1" bash "$SCRIPT" >"$WORK/out" 2>&1 || rc=$?; echo "$rc"; }

D="$(days_ago 1)"
OLD="$(days_ago 181)"
KEEP="$(days_ago 179)"
mkdir -p "$WORK/remote/logs/$OLD" "$WORK/remote/logs/$KEEP"
echo x > "$WORK/remote/logs/$OLD/a.log.gz"
echo x > "$WORK/remote/logs/$KEEP/a.log.gz"

# 1 + 2
mkdir -p "$WORK/export/$D"
echo data > "$WORK/export/$D/app.log.gz"
rc="$(ran "$D")"
[[ "$rc" == 0 ]] && check "1 exit 0" ok || check "1 exit 0 (got $rc)" no
[[ -f "$WORK/remote/logs/$D/app.log.gz" ]] && check "1 uploaded" ok || check "1 uploaded" no
[[ ! -e "$WORK/export/$D" ]] && check "1 local export removed" ok || check "1 local export removed" no
[[ ! -e "$WORK/remote/logs/$OLD" ]] && check "2 181-day prefix deleted" ok || check "2 181-day prefix deleted" no
[[ -e "$WORK/remote/logs/$KEEP" ]] && check "2 179-day prefix kept" ok || check "2 179-day prefix kept" no

# 3: failed check keeps local files, deletes nothing
OLD2="$(days_ago 200)"
mkdir -p "$WORK/remote/logs/$OLD2" "$WORK/export/$D"
echo data > "$WORK/export/$D/app.log.gz"
rc="$(FAIL_CHECK=1 ran "$D")"
[[ "$rc" == 1 ]] && check "3 exit 1" ok || check "3 exit 1 (got $rc)" no
[[ -f "$WORK/export/$D/app.log.gz" ]] && check "3 local files kept" ok || check "3 local files kept" no
[[ -e "$WORK/remote/logs/$OLD2" ]] && check "3 retention not run" ok || check "3 retention not run" no

# 4, 5
rc="$(ran "not-a-date")"
[[ "$rc" == 2 ]] && check "4 bad date refused" ok || check "4 bad date refused (got $rc)" no
rc="$(ran 2000-01-01)"
[[ "$rc" == 1 ]] && check "5 missing export fails" ok || check "5 missing export fails (got $rc)" no

[[ $fails -eq 0 ]] || { echo "$fails failed"; exit 1; }
echo "all passed"
