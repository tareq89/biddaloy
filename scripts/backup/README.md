# scripts/backup

Encrypted PostgreSQL backup and restore. See
[`docs/architecture/13-backup-restore.md`](../../docs/architecture/13-backup-restore.md)
for the full recovery story (RPO/RTO, retention, key rotation).

## backup.sh

Runs on a schedule inside the `backup` docker-compose service
(`BACKUP_SCHEDULE`, `TZ=Asia/Dhaka`; unset = hourly in R2 mode, `0 2 * * *` in
legacy mode). The container runs
as non-root (uid 10001) via supercronic, and logs go to
`docker compose logs backup`. Pipeline:

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
Optional: `BACKUP_RETENTION_DAYS` (legacy mode), `SENTRY_CRON_MONITOR_URL`.

### R2 mode (production)

Set all of `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
`BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_RCLONE_CRYPT_PASSWORD`,
`BACKUP_RCLONE_CRYPT_SALT` (all or none) and each hourly run does:

```
dump -> db/hourly/<UTC ts>.dump.age
     -> from 02:00 Dhaka, if today's daily is missing: copy to db/daily/<date>.dump.age
     -> prune db: BACKUP_HOURLY_KEEP=72, BACKUP_DAILY_KEEP=30
     -> rclone sync SeaweedFS -> r2crypt (changed/deleted files to
        files-trash/<date>/<path>-<HHMMSS>; a dry run first refuses
        the sync, touching nothing, above BACKUP_FILES_MAX_DELETE=500)
     -> purge trash date folders older than BACKUP_TRASH_DAYS=30
     -> Uptime Kuma push (BACKUP_PUSH_URL): up, or down&msg=<failed step>
```

A `change-me` or shorter-than-16-character R2 secret or crypt value stops the
container at start. With none set it keeps the old single-key `backups/db/`
behaviour (dev and the restore drill). Tests: `scripts/backup/backup.test.sh
--shim` runs the Docker-free shim cases (CI runs them through
`backup.shim.infra.test.sh`); without the flag it also runs the compose
integration case.

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
