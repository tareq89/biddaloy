# shellcheck shell=bash
# Sourced by biddaloy-nightly, biddaloy-doctor, biddaloy-restore-prod and biddaloy-staging (needs ROOT and REPO; the backup
# listing helpers also need the caller's dc()).
#
# kept_file <stack> <name> <path in the checkout>: the copy that stack's last ok deploy kept in
# $ROOT/<stack>/ (deploy.yml keeps stack.yml and smoke-post-deploy.mjs), else the checkout's file
# (only before a first ok deploy). The checkout follows whatever stack was deployed last, so a
# host script must not run a stack with it.
kept_file() { if [[ -f "$ROOT/$1/$2" ]]; then printf '%s\n' "$ROOT/$1/$2"; else printf '%s\n' "$REPO/$3"; fi; }

# list_backups <prefix>: the `aws s3 ls` lines of the backup bucket under <prefix> ("db/hourly/",
# "db/daily/" or one exact key), read inside the jobs container (the only place with the R2 token).
# Needs the caller's dc(). Line: "<date> <time> <size> <name>" (UTC, TZ=UTC).
# shellcheck disable=SC2016 # runs in the container, where these variables exist
LIST_SH='set -eu
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
aws s3 ls --endpoint-url "$BACKUP_S3_ENDPOINT" "s3://$BACKUP_S3_BUCKET/$1"'
list_backups() { dc run --rm -T --no-deps -e TZ=UTC jobs sh -c "$LIST_SH" sh "$1"; }

# pick_latest <listing> [cutoff "YYYY-MM-DD HH:MM:SS"]: the newest *.dump.age line (names are
# timestamps, so the highest name), only those written before the cutoff when one is given.
pick_latest() {
  printf '%s\n' "$1" | awk -v c="${2:-}" 'NF >= 4 && $4 ~ /\.dump\.age$/ && (c == "" || ($1 " " $2) < c)' | sort -k4 | tail -1
}
