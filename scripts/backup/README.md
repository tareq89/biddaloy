# scripts/backup

Encrypted PostgreSQL backup and restore. See
[`docs/architecture/13-backup-restore.md`](../../docs/architecture/13-backup-restore.md)
for the full recovery story (RPO/RTO, retention, key rotation).

## `--no-migrate`, and no drill

`restore.sh <db/...key> <url> [--no-migrate]`: a `db/` key is read from R2 with
`BACKUP_S3_*`; `--no-migrate` skips migrations. There is no weekly restore drill any more (D5):
the staging refresh restores a real dump every time, so it is the drill.

## db-swap.sh

One script swaps a freshly built database in by rename. The demo rebuild uses it now; the staging
refresh will too. The demo image gets the same file through a second build context named `backup`.

```bash
DATABASE_URL=postgres://user:pass@db:5432/postgres \
  scripts/backup/db-swap.sh biddaloy_staging biddaloy_staging_next   # live, next
# swap ok: biddaloy_staging (was biddaloy_staging_next), previous kept as biddaloy_staging_prev
scripts/backup/db-swap.sh --drop-prev-old biddaloy_staging           # once the app is back
```

```mermaid
flowchart LR
  P[live_prev] -->|rename| PO[live_prev_old]
  L[live] -->|rename| P
  N[live_next] -->|rename| L
```

Guards: both names must match `^biddaloy_(staging|demo)[a-z0-9_]*$` and be the same family, so it
can never touch `biddaloy` (production). One swap per live name (flock). If a rename fails
half way it puts the old live back and prints `swap FAILED at <step>: <psql error>`. It stops
(`FAILED at prev-to-prev-old`) when `_prev_old` still exists: drop it first. Test:
`scripts/backup/db-swap.infra.test.sh` (needs Docker).

## backup.sh

Runs on a schedule inside the `backup` docker-compose service
(`BACKUP_SCHEDULE`, `TZ=Asia/Dhaka`; unset = hourly in R2 mode, `0 2 * * *` in
legacy mode). The container runs
as non-root (uid 10001) via supercronic, and logs go to
`docker compose logs backup`. Pipeline:

```
pg_dump -Fc -Z 6  →  age -r $BACKUP_AGE_PUBLIC_KEY  →  aws s3 cp - s3://$S3_BUCKET/backups/db/<timestamp>.dump.age
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
     -> prune db: BACKUP_HOURLY_KEEP=100, BACKUP_DAILY_KEEP=30
     -> rclone sync SeaweedFS -> r2crypt (changed/deleted files to
        files-trash/<date>/<path>-<HHMMSS>; a dry run first refuses
        the sync, touching nothing, above BACKUP_FILES_MAX_DELETE=500)
     -> purge trash date folders older than BACKUP_TRASH_DAYS=30
     -> Uptime Kuma push (BACKUP_PUSH_URL): up, or down&msg=<failed step>
```

A `change-me` or shorter-than-16-character R2 secret or crypt value stops the
container at start. With none set it keeps the old single-key `backups/db/`
behaviour (dev). Tests: `scripts/backup/backup.test.sh
--shim` runs the Docker-free shim cases (CI runs them through
`backup.shim.infra.test.sh`); without the flag it also runs the compose
integration case.

## restore.sh

```bash
scripts/backup/restore.sh <s3-key-or-local-file> <TARGET_DATABASE_URL>
```

Decrypts the chosen archive, restores it into `TARGET_DATABASE_URL`, and
prints integrity counts from `verify.sql`. It does **not** run migrations:
run `node server/dist/scripts/migrate.js run` from the app image afterwards.
`--require-empty` (prod restore, used by `deploy/bin/biddaloy-restore-prod`)
refuses a target that has a user or a school besides `default-school` (exit 3)
and does the check, the schema wipe and the load in one transaction. Refuses to run if `TARGET_DATABASE_URL` equals the `DATABASE_URL`
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
# Private key: AGE-SECRET-KEY-1... — master copy off the host. See the doc's "Key handling"
```

## Secrets discipline

Neither script uses `set -x`, and neither prints `DATABASE_URL` or any key
material to stdout/stderr. If you add debug output, log shape/status only
("upload ok", "12 objects found") — never a variable that could hold a
credential.

## staging-refresh.sh

Builds tomorrow's staging database from last night's prod backup, scrubbed. Runs in the
staging `jobs` container: `docker compose -p staging run --rm jobs /app/staging-refresh.sh`.
It ends at a ready `<POSTGRES_DB>_next`; the host migrates it and calls `db-swap.sh`.

```mermaid
flowchart LR
  A[guard] --> B[wait for<br/>db/daily/DAY.dump.age] --> C[create _next] --> D[restore.sh] --> E[scrub.sql] --> F[verify counts] --> G["staging_next ready"]
```

Options (Epic 88, D16):

```bash
staging-refresh.sh                                   # as above: build <POSTGRES_DB>_next from today's daily
staging-refresh.sh --target biddaloy_staging_drill   # fill the drill db itself (drop, create, restore, scrub, verify; no swap)
staging-refresh.sh --target biddaloy_staging --from latest-hourly
staging-refresh.sh --target biddaloy_staging_drill --from db/daily/2026-10-28.dump.age
```

- `--target` accepts exactly `biddaloy_staging` and `biddaloy_staging_drill`; anything else exits 2 before any command runs.
- `--from` is `latest-daily` (default, the only one that waits for the deadline), `latest-hourly`, or an exact key.
- The scrub always runs. `db-swap.sh` also accepts `biddaloy_staging_dev` (guard only; dev is never renamed).

Needs (all passed by `deploy/stack.yml`, from `infra/secrets/staging.enc.env`):

- `POSTGRES_DB` (must start `biddaloy_staging`), `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `BACKUP_S3_ENDPOINT` (https), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`: the **read-only** R2 token
- the age private key at `/run/age/key.txt` (`BACKUP_AGE_KEY_DIR` mounted read-only)
- `STAGING_PASSWORD_HASH_B64` (base64 of a bcrypt cost-12 hash), `SMOKE_SCHOOL_SLUG`, `PLATFORM_TENANT_ID` (uuid)
- optional: `STAGING_REFRESH_PUSH_URL` (Kuma, failures only, never with `--target`), `STAGING_REFRESH_DEADLINE` (HH:MM, default 02:50),
  `STAGING_REFRESH_LOCK` (extra lock file; unset by default, the host unit's `flock` is the real lock)

Why base64: compose expands every `$` in a `.env` value, and a bcrypt hash (`$2b$12$...`) is full
of them. Make the value from the app image, then check it with `config:check --env staging`:

```bash
node -e "require('/app/server/dist/modules/auth/password-hash').hashPassword(process.argv[1]).then(h => console.log(Buffer.from(h).toString('base64')))" '<STAGING_PASSWORD>'
```

Exit codes: `0` ready; `1` failed, staging untouched, a `down` push was sent; `2` refused
(wrong database name, missing or malformed env). Output is step names and counts only.
Example: `step 5/7: scrub` then `staging_next ready`.
