# scripts/backup

Encrypted PostgreSQL backup and restore. See
[`docs/architecture/13-backup-restore.md`](../../docs/architecture/13-backup-restore.md)
for the full recovery story (RPO/RTO, retention, key rotation).

## backup.sh

Runs on a schedule inside the `backup` docker-compose service
(`BACKUP_SCHEDULE`, default `0 2 * * *`, `TZ=Asia/Dhaka`). Pipeline:

```
pg_dump -Fc  →  age -r $BACKUP_AGE_PUBLIC_KEY  →  aws s3 cp - s3://$S3_BUCKET/backups/db/<timestamp>.dump.age
```

Plaintext never touches disk — it only exists in the pipe between the three
processes. After a successful upload, objects under `backups/db/` older
than `BACKUP_RETENTION_DAYS` (default 30) are deleted.

Run it manually (e.g. inside the running `backup` container, or any shell
with the same env vars and `pg_dump`/`age`/`aws` installed):

```bash
docker compose exec backup /app/backup.sh
```

Required env: `DATABASE_URL`, `BACKUP_AGE_PUBLIC_KEY`, `S3_BUCKET`,
`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
Optional: `BACKUP_RETENTION_DAYS`, `SENTRY_CRON_MONITOR_URL`.

## restore.sh

```bash
scripts/backup/restore.sh <s3-key-or-local-file> <TARGET_DATABASE_URL>
```

Decrypts the chosen archive, restores it into `TARGET_DATABASE_URL`, runs
server migrations against it, and prints integrity counts from
`verify.sql`. Refuses to run if `TARGET_DATABASE_URL` equals the `DATABASE_URL`
env var (the running production database) — see the script for the exact
check.

Example:

```bash
scripts/backup/restore.sh backups/db/20260907T020000Z.dump.age \
  postgres://postgres:postgres@localhost:5432/biddaloy_restore_test
```

## Generating an age keypair

```bash
age-keygen -o key.txt
# Public key:  age1... — goes in BACKUP_AGE_PUBLIC_KEY
# Private key: AGE-SECRET-KEY-1... — stored outside the host, see the doc
```

## Secrets discipline

Neither script uses `set -x`, and neither prints `DATABASE_URL` or any key
material to stdout/stderr. If you add debug output, log shape/status only
("upload ok", "12 objects found") — never a variable that could hold a
credential.
