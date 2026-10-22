# Backup and disaster recovery

How SchoolManager's database gets backed up, how to restore it, and what to do
about the parts a database restore doesn't cover (the object store,
in-flight background jobs).

> Operator steps (day 0, first deploy, releases, alerts, restore) live in
> [28-platform-runbook.md](28-platform-runbook.md). This page keeps how backups work.

## The numbers

|                                      |                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (how much data you can lose) | 1 hour — one backup an hour (R2 mode; 24 h in legacy/dev mode, default 02:00)                                                                            |
| **RTO** (how long a restore takes)   | 4 hours                                                                                                                                                  |
| **Retention**                        | 72 hourly + 30 daily dumps, 30 days of deleted-file history (R2 mode)                                                                                    |
| **Drill cadence**                    | Quarterly — run [`restore-drill.yml`](../../.github/workflows/restore-drill.yml) manually                                                                |
| **Backup owner**                     | Whoever holds the `BACKUP_AGE_PUBLIC_KEY`/private-key pair for the environment (see "Key handling" below) — set this to a real name/role per environment |

RPO of 1h means: if the database is lost right now, everything written
since the last hourly backup (up to 1 hour ago) is gone.

## How a backup happens

```mermaid
flowchart LR
    db[(Postgres db)] -->|pg_dump -Fc| dump[dump bytes]
    dump -->|age -r PUBLIC_KEY| enc[encrypted bytes]
    enc -->|aws s3 cp| bucket[(S3 bucket<br/>backups/db/*.dump.age)]
    logos[Live app writes<br/>e.g. school logos] -.->|StorageService.put| bucket
```

### The hourly run to R2 (production)

With the `BACKUP_S3_*` vars set, `backup.sh` runs every hour and writes to
Cloudflare R2 instead. Example key: `db/hourly/20260920T200000Z.dump.age`.

```mermaid
flowchart TD
    start([cron, every hour]) --> dump["pg_dump | age | aws s3 cp<br/>db/hourly/&lt;UTC ts&gt;.dump.age"]
    dump --> h{"Dhaka hour >= 02<br/>and today's daily missing?"}
    h -->|yes| daily["server-side copy to<br/>db/daily/&lt;date&gt;.dump.age"]
    h -->|no| prune
    daily --> prune["prune db: keep 72 hourly,<br/>30 daily"]
    prune --> files["rclone sync SeaweedFS bucket<br/>(not backups/) to r2crypt:files<br/>changed or deleted files go to<br/>files-trash/&lt;date&gt;/"]
    files --> trash["purge trash folders older than 30 days"]
    trash --> push["Uptime Kuma push: up<br/>(any failed step: down + step name, exit non-zero)"]
```

| What                                                           | Where in R2           | Kept for     |
| -------------------------------------------------------------- | --------------------- | ------------ |
| Hourly database dumps                                          | `db/hourly/`          | 72 (3 days)  |
| Daily database dumps                                           | `db/daily/`           | 30 (30 days) |
| Files (contents + names encrypted; top-level folder names too) | `files/`              | current copy |
| Deleted/changed files                                          | `files-trash/<date>/` | 30 days      |

**RPO is now 1 hour** (was 24 h). Without `BACKUP_S3_*` (local dev, the
restore drill) the old behaviour stays: one `backups/db/` key per run, once
a day at 02:00 by default, pruned by age with `BACKUP_RETENTION_DAYS`, no
files sync. Legacy dumps sit on the same disk as the database, so legacy
mode stays daily unless you set `BACKUP_SCHEDULE` yourself.

The default schedule depends on the mode (`entrypoint.sh` picks it when
`BACKUP_SCHEDULE` is unset):

| Mode                     | Default `BACKUP_SCHEDULE` |
| ------------------------ | ------------------------- |
| R2 (all six vars set)    | `0 * * * *` (hourly)      |
| Legacy (none of the six) | `0 2 * * *` (02:00 daily) |

**Upgrading an existing deploy:** a production `.env` that sets
`BACKUP_SCHEDULE='0 2 * * *'` must drop that line (or set `0 * * * *`), or
the R2 backup stays daily. After the switch, keep the old `backups/db/`
objects in SeaweedFS: the files sync skips `backups/`, so they are your only
history from before R2. Delete them once (a one-time cleanup) only after R2
holds 30 daily dumps in `db/daily/` and a test restore from R2 has worked
(see "Restore runbook" below).

**Safety checks before files are touched:**

- The container refuses to start (and `backup.sh` refuses to run) while
  `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_RCLONE_CRYPT_PASSWORD` or
  `BACKUP_RCLONE_CRYPT_SALT` still says `change-me` or is shorter than 16
  characters. Example: uncommenting `BACKUP_RCLONE_CRYPT_PASSWORD=change-me`
  from `.env.example` stops the container with
  `BACKUP_RCLONE_CRYPT_PASSWORD is a placeholder or shorter than 16 characters`.
- The files sync refuses to sync (touches nothing) when it would delete more
  than `BACKUP_FILES_MAX_DELETE` (default 500) files in one run. A
  `rclone sync --dry-run` with the same flags runs first; only when it passes
  does the real sync run. The step fails, Kuma goes down, and it stays down
  every hour until a human checks the source. This catches a wrong or
  half-empty source bucket that the empty-source guard cannot see. After a
  real mass delete, raise the value for one run.
  Why the dry run: rclone checks `--max-delete` as it goes, so a plain sync
  moves the first 500 files to the trash and only then fails. The next run
  moves 500 more, and the run that moves the last batch goes green.
- Each trash copy gets the Dhaka run time as a suffix
  (`files-trash/2026-10-20/tenants/7/logos/a.png-140000`), so a file changed
  twice on one date keeps both old copies.
- Recommended (a Cloudflare setting, not code): add R2 **Bucket Lock** rules
  so a compromised host with the delete-capable token cannot wipe the
  offsite dumps. Keep each lock clearly **shorter** than its keep window, for
  example `db/hourly/` 48 hours (keep 72) and `db/daily/` 25 days (keep 30).
  A lock equal to the window breaks: one extra or manual run, or a dump that
  finishes a few seconds faster, makes the prune try to delete a key that is
  still locked. The prune then fails, and because the db prunes run first,
  that run also skips the files sync and the daily prune.

If the network is down at the start, the run probes and waits (up to
`BACKUP_NET_WAIT_SECS`, default 900) instead of failing at once.

Two independent things land in the same bucket, and that's the key fact
this whole doc is built around:

- **`backups/db/*.dump.age`** — a snapshot (legacy/dev layout, daily by default; R2 uses `db/hourly/`), written by
  [`scripts/backup/backup.sh`](../../scripts/backup/backup.sh). Consistent
  as of the moment `pg_dump` ran.
- **Everything else** (e.g. `tenants/<id>/logos/*.png`, written by
  `StorageService` — see `server/src/modules/storage/`) — live, current
  right now, never "backed up" in the pg_dump sense because it was never
  in Postgres to begin with. The bucket itself _is_ the durable copy.

**Consistency rule:** after a restore, the database reflects yesterday's
world and the bucket reflects today's (up to an hour old in R2 mode). A row can reference an object key
that didn't exist yet at backup time (fine — it exists now) or, if an
object was deleted between the backup and now, a row can reference a key
that's gone. `scripts/backup/verify.sql` prints every `schools.logo_key`
value after a restore specifically so an operator can spot-check which of
those went missing — see the restore runbook below.

Plaintext dump bytes never touch disk — `backup.sh`'s three commands
(`pg_dump` → `age` → `aws s3 cp`) are one pipe, and the pipe is the only
place the plaintext exists.

## Two kinds of backup

This doc is the **platform** backup: an hourly `pg_dump` of the whole
database, restorable only by someone with server/infra access. It's not
what an individual school admin uses.

A school admin instead exports and restores **their own school's data**
as one `.xlsx` workbook, entirely through the app UI — no server access
needed, and it never touches other tenants' data. That's a separate
feature with its own retention rules and restore semantics — see
[14-school-workbook.md](14-school-workbook.md).

## Key handling

`BACKUP_AGE_PUBLIC_KEY` (encrypts) lives in `.env`/deploy config like any
other env var — it's not a secret. The matching private key
(`BACKUP_AGE_PRIVATE_KEY_FILE`, used by `restore.sh`) is the one thing that
actually matters:

- **Where it lives:** in two places.
  1. The master copy is outside the host, in a password manager or vault the
     backup owner controls. Never committed, never in `.env`.
  2. Since the weekly drill (D18), a copy also sits **on the VM** at
     `/opt/biddaloy/<env>/drill/key.txt` (owner 10001, mode 0400), mounted only
     into the `backup` container. `backup.sh` still needs only the public key.
- **What that costs.** The VM now holds both the private key and the R2
  credentials. Someone who takes over the host can read every retained dump
  (72 hourly + 30 daily, so about 30 days of history), including rows already
  deleted from the live database. Before D18 a host compromise exposed only the
  live data. We accept this so the drill runs on the VM and the key never
  reaches a CI runner.
- **Rotation:** generate a new keypair (`age-keygen`), point
  `BACKUP_AGE_PUBLIC_KEY` at the new public half and replace the host's
  `drill/key.txt` with the new private half in the same deploy (otherwise the
  next drill cannot decrypt). New backups from
  that point encrypt to the new key. **No re-encryption of old archives is
  needed** — keep the old private key until no archive it encrypted is
  left. Do not count days: R2 keeps the last 30 daily dumps by count, so a
  missed run can keep an old-key dump past day 30. Before you discard it,
  list what is left and check that no key is older than the rotation date:
  `aws s3 ls s3://<BACKUP_S3_BUCKET>/db/ --recursive --endpoint-url https://<acct>.r2.cloudflarestorage.com`
  (keys carry their date, e.g. `db/daily/2026-10-20.dump.age`). Check any
  legacy `backups/db/` archives you still keep the same way (legacy prunes
  by age, `BACKUP_RETENTION_DAYS`).
- **Lost key = archives unrecoverable.** Stated plainly because it's true:
  age has no recovery mechanism and no backdoor. If the private key is
  gone, every archive it encrypted is permanently unreadable, full stop.
  This is why the key lives somewhere with its own backup/recovery story
  (a password manager, a vault) — never "just on someone's laptop."

## Redis/BullMQ is not system of record

Communication sends go through a BullMQ queue backed by Redis (see
[10-third-party-services.md](10-third-party-services.md)). Redis is not
backed up — it's disposable job state, not data. After a restore, any
`communication_logs` row still `QUEUED` was mid-flight in Redis at backup
time, and that queue entry no longer exists (it belonged to the
pre-restore Redis, or Redis was flushed as part of the incident that
triggered the restore).

An operator decides what to do with those rows after every restore —
re-enqueue them, or mark them failed so nothing silently sits `QUEUED`
forever:

```sql
-- See what's stuck
SELECT id, tenant_id, medium, recipient, created_at
FROM communication_logs
WHERE status = 'QUEUED';

-- Option A: mark them failed (safe default — nothing sends unexpectedly)
UPDATE communication_logs SET status = 'FAILED' WHERE status = 'QUEUED';

-- Option B: re-enqueue via the app's own retry path instead of writing
-- directly to Redis — see server/src/modules/communications/
-- communications.service.ts for the send path these logs came from.
-- Only safe once you've confirmed, per row, that the original message
-- was never actually sent (check with the provider, or use an
-- idempotent retry path keyed on a stable message ID). The dump and
-- Redis are not captured atomically, so a row still QUEUED in the
-- restored dump is not proof the send never went out — re-enqueuing on
-- that assumption alone can duplicate a message the provider already
-- delivered. When in doubt, use Option A.
```

## Drill

Every Sunday 03:30 (Asia/Dhaka) the `backup` container proves the newest R2
dump can really be restored. Script: `scripts/backup/drill.sh`.

```mermaid
sequenceDiagram
    participant C as supercronic
    participant D as drill.sh
    participant R as R2
    participant P as Postgres
    participant K as Uptime Kuma
    C->>D: Sunday 03:30
    D->>R: newest key under db/hourly/
    D->>P: create scratch DB biddaloy_drill
    D->>R: restore.sh db/hourly/... --no-migrate
    D->>P: verify.sql on scratch DB and on live DB
    D->>R: one random live file via rclone crypt, sha256 vs live
    D->>P: drop biddaloy_drill (always, even on failure)
    D->>K: push up (ok-N-tables) or down (failed step)
```

**What "pass" means**

- For each table in `verify.sql`, drill count is not above the live count
  (data only moves forward after a dump) and is not 0 when live is above 0.
- One random file from the live bucket has the same sha256 read back through
  `r2crypt:files/<key>`. An empty bucket skips this check.

**Safety.** The scratch database name must contain `drill`, and
`DRILL_DATABASE_URL` must differ from `DATABASE_URL`, or the script refuses to
start. The live database is only read (`verify.sql` counts). No URL, key or
password is printed. Before it creates the scratch database it checks that the
disk has about 2.5x the live database size free (the scratch copy, the
decrypted dump and live Postgres share one disk). Only one drill runs at a
time (`flock`): a manual run during the cron run exits without touching the
other run's database.

**Reading Kuma.** One green beat per week with message `ok-8-tables`. A red
beat carries the failed step: `find-dump`, `disk`, `create-db`, `restore`,
`counts`, `file-roundtrip`, `drop-db` (the run passed but the scratch database
could not be dropped, so a full copy of prod is still in the cluster), or
`config` for a missing setting. Telegram and SMS fire from the push monitor (D14).

**Run by hand** (on the VM):

```bash
docker compose exec backup /app/drill.sh
```

**Setup.**

- `DRILL_SCHEDULE` (cron, default `30 3 * * 0`) and `DRILL_PUSH_URL` (in sops).
- The age private key, as `key.txt` in a host directory mounted read-only at
  `/run/age`. Host directory: `BACKUP_AGE_KEY_DIR`, set per env (for example
  `/opt/biddaloy/prod/drill`), with **no default**, so prod's key can never
  reach staging. `provision.yml` creates the directory (owner `10001`, the
  backup user, mode `0500`). Nothing writes the key yet: the operator copies it
  in by hand (owner `10001`, mode `0400`):

  ```bash
  sudo install -o 10001 -g 10001 -m 0400 key.txt /opt/biddaloy/prod/drill/key.txt
  ```

  Until it is there, only the drill fails, at step `config` (Kuma gets
  `down config`). `docker compose up` and the hourly dumps, which need only the
  public key, are not affected. Only the `backup` container mounts it.

- In Uptime Kuma, the `drill-weekly` monitor: type **Push**, heartbeat interval
  **8 days**, retries **0**. The default 60 s interval would page all week.
- Optional `DRILL_DATABASE_URL` / `DRILL_ADMIN_URL` default to the live server
  with database `biddaloy_drill` / `postgres`.

**CI.** `.github/workflows/restore-drill.yml` runs a synthetic drill (seed,
backup, restore, diff) on pull requests that touch `scripts/backup/**` or the
workflow itself, and on manual dispatch.

## Restore runbook

```bash
# 1. Point at the archive and a target database that is NOT production.
#    restore.sh refuses to run if TARGET_DATABASE_URL equals this shell's
#    own DATABASE_URL, precisely to stop this mistake.
export BACKUP_AGE_PRIVATE_KEY_FILE=/path/to/age-key.txt   # never in .env
export S3_BUCKET=biddaloy S3_ENDPOINT=https://s3.example.com \
       S3_REGION=us-east-1 S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...

scripts/backup/restore.sh \
  backups/db/20260907T020000Z.dump.age \
  postgres://postgres:postgres@localhost:5432/biddaloy_restored

# R2 form (production dumps). A bare key starting with db/ is read from the
# R2 bucket using BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET / BACKUP_S3_ACCESS_KEY_ID /
# BACKUP_S3_SECRET_ACCESS_KEY (the same vars the backup container has):
export BACKUP_S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com \
       BACKUP_S3_BUCKET=<bucket> BACKUP_S3_ACCESS_KEY_ID=... BACKUP_S3_SECRET_ACCESS_KEY=...
scripts/backup/restore.sh \
  db/hourly/20260920T200000Z.dump.age \
  postgres://postgres:postgres@localhost:5432/biddaloy_restored
```

What it does, in order: download (or read a local file) → `age --decrypt`
→ `pg_restore --clean --if-exists --no-owner` (with `--require-empty`: one
transaction that checks the target is empty, drops schema `public` and loads the
dump) → print `scripts/backup/verify.sql`'s row/tenant counts
and the `schools.logo_key` list. See
[`scripts/backup/README.md`](../../scripts/backup/README.md) for every env
var it reads.

Then: reconcile `communication_logs` (above), and spot-check any
`logo_key` the verify output printed against the bucket if you suspect
objects were lost around the same incident.

### Restore prod onto a fresh VM (`biddaloy-restore-prod`)

Which `--from` to pass depends on whether the old VM still runs:

| Situation                            | Pass                                                                                                             | Why                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The old VM is dead (disaster)        | `--from latest-hourly` (or `latest-daily`)                                                                       | Picks the newest dump written before this VM's `prod_pgdata` volume was made, so never this VM's own empty dumps.                                                                                                      |
| Planned move (the old VM still runs) | Stop the old VM's app and `backup`, take or wait for one last dump, then `--from db/hourly/<that file>.dump.age` | `latest-*` skips everything written after the new volume was made, so it would restore older data. The script prints the newest skipped dump to make this easy: `newest skipped: db/hourly/20261022T120000Z.dump.age`. |

A fresh prod does not run its hourly `backup` while its database has no user (`deploy.yml`), so it
does not fill the R2 prefixes with empty dumps. The next `biddaloy-deploy prod` after the restore starts it.

### Restore files from R2

Files are encrypted in R2 (file contents and names), so read them through
the `r2crypt` remote. It is rooted at the bucket, so `files/` and
`files-trash/` both live under it. Build a throwaway rclone config the same
way `backup.sh` does (remotes `r2` and `r2crypt`; the crypt password/salt go
through `rclone obscure`), then:

```bash
# one tenant's files
rclone copy r2crypt:files/tenants/<tenant-id> ./out
# a file deleted by mistake (still in trash for BACKUP_TRASH_DAYS)
rclone copy r2crypt:files-trash/2026-10-20/tenants/<tenant-id> ./out-trash
# trash copies end in the run time (-HHMMSS, Dhaka). The biggest suffix is
# the newest copy from that date. Delete the copies you don't want, then
# strip the suffix (bash 4+):
shopt -s globstar
for f in ./out-trash/**/*-[0-9][0-9][0-9][0-9][0-9][0-9]; do mv -n "$f" "${f%-??????}"; done
```

In the R2 console the top-level folder names (`files`, `files-trash`, the
dates) are encrypted too; only `db/` is readable.

Example: a teacher deleted `tenants/7/logos/a.png` on 2026-10-20. The 14:00
run moved it to `files-trash/2026-10-20/tenants/7/logos/a.png-140000`, and it
stays restorable until that date folder is purged 30 days later.

### Old fee rows and the money CHECKs

Migration `1791900000300` adds two CHECKs on `student_fees`:
`paid + discount <= total`, and a WAIVED bill has `paid + discount = total`.
They are `NOT VALID`. That skips rows already in the table, but Postgres
still checks every row that is inserted or updated later.

| Restore path            | Old bad row in the backup                                                                                                                                        | What to do                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform (`restore.sh`) | Loads fine: `pg_dump` adds a `NOT VALID` CHECK after the data                                                                                                    | Run the audit SQL in the migration's docblock on the restored database. Fix rows by hand. A later payment or reversal on a bad row is refused (409). |
| School workbook         | The `student_fees` tab rejects that row before anything is written, e.g. `row 7, column paid_amount: paid_amount plus discount_amount is more than total_amount` | Fix the row in the file (or fix the source school with the audit SQL and export again), then restore.                                                |

The restore is refused with a row-by-row list, never a 500. Only run
`VALIDATE CONSTRAINT` once the audit SQL returns no rows.

## Env vars ([15.3.x])

All in `.env.example`, grouped under "Object storage" and "Backup and
disaster recovery":

| Var                            | Ticket | Purpose                                                                                                                           |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT`                  | 15.3.1 | Bucket endpoint (SeaweedFS in dev, your provider in prod)                                                                         |
| `S3_REGION`                    | 15.3.1 | Bucket region                                                                                                                     |
| `S3_BUCKET`                    | 15.3.1 | Bucket name                                                                                                                       |
| `S3_ACCESS_KEY_ID`             | 15.3.1 | Bucket credentials                                                                                                                |
| `S3_SECRET_ACCESS_KEY`         | 15.3.1 | Bucket credentials                                                                                                                |
| `S3_FORCE_PATH_STYLE`          | 15.3.1 | `true` for SeaweedFS/self-hosted, unset for AWS S3                                                                                |
| `BACKUP_AGE_PUBLIC_KEY`        | 15.3.2 | Encrypts new backups                                                                                                              |
| `BACKUP_SCHEDULE`              | 15.3.2 | Cron schedule, `TZ=Asia/Dhaka`. Unset: `0 * * * *` (hourly) in R2 mode, `0 2 * * *` (daily) in legacy mode                        |
| `BACKUP_RETENTION_DAYS`        | 15.3.2 | Legacy mode only (no `BACKUP_S3_*`): backups older than this are deleted (default 30)                                             |
| `BACKUP_S3_ENDPOINT`           | #1745  | R2 endpoint `https://<acct>.r2.cloudflarestorage.com`. The six `BACKUP_S3_*` / `BACKUP_RCLONE_CRYPT_*` vars are all-or-none       |
| `BACKUP_S3_BUCKET`             | #1745  | R2 bucket for `db/` and `files/`                                                                                                  |
| `BACKUP_S3_ACCESS_KEY_ID`      | #1745  | R2 API token, scoped to the bucket                                                                                                |
| `BACKUP_S3_SECRET_ACCESS_KEY`  | #1745  | R2 API token secret                                                                                                               |
| `BACKUP_RCLONE_CRYPT_PASSWORD` | #1745  | Encrypts file contents and names. Store a copy outside the host                                                                   |
| `BACKUP_RCLONE_CRYPT_SALT`     | #1745  | Second crypt secret (salt). Store a copy outside the host                                                                         |
| `BACKUP_PUSH_URL`              | #1745  | Uptime Kuma push URL (`?status=up/down&msg=<step>` appended), `http://uptime-kuma:3001/api/push/<token>` on prod. Unset = no push |
| `BACKUP_HOURLY_KEEP`           | #1745  | Hourly dumps kept (default 72)                                                                                                    |
| `BACKUP_DAILY_KEEP`            | #1745  | Daily dumps kept (default 30)                                                                                                     |
| `BACKUP_TRASH_DAYS`            | #1745  | Days a deleted file stays in `files-trash/` (default 30)                                                                          |
| `BACKUP_FILES_MAX_DELETE`      | #1745  | Files sync refuses to sync (touches nothing) if it would delete more than this many files in one run (default 500)                |
| `SENTRY_CRON_MONITOR_URL`      | 15.3.2 | Optional cron check-in                                                                                                            |
| `DRILL_SCHEDULE`               | #1774  | Cron for the weekly restore drill (default `30 3 * * 0`)                                                                          |
| `DRILL_PUSH_URL`               | #1774  | Uptime Kuma push URL for the drill, `http://uptime-kuma:3001/api/push/<token>` on prod. Unset = no push                           |
| `DRILL_DATABASE_URL`           | #1774  | Scratch database (name must contain `drill`; default `<live server>/biddaloy_drill`)                                              |
| `BACKUP_AGE_PRIVATE_KEY_FILE`  | 15.3.3 | Key path inside the container (`/run/age/key.txt`). The key itself is never in `.env`; see "Key handling"                         |
| `BACKUP_AGE_KEY_DIR`           | #1774  | Host dir of that key, mounted at `/run/age` in `backup` only: `/opt/biddaloy/<env>/drill` (10001, 0500). No default               |

## Learnings (#1745)

- Trash is pruned by the date in the `files-trash/<date>/` folder name, not
  with `rclone delete --min-age`: files moved by `--backup-dir` keep their
  original modification time, so `--min-age` would delete them straight away.
- R2 prunes count keys, not object age: UTC timestamps in key names sort by
  time, so "keep newest N" needs no date parsing. Legacy mode (dev, drill)
  keeps the old `LastModified` age prune with `BACKUP_RETENTION_DAYS`.
- Asia/Dhaka is fixed UTC+6, so `backup.sh` does the "is it 02:00 there?"
  check with epoch arithmetic. `BACKUP_NOW` (UTC ISO) fakes the clock in tests.
- rclone passwords are passed to `rclone obscure -` on stdin, never as an
  argument, and the config file is 0600 in a throwaway dir removed on exit.
- `scripts/backup/backup.test.sh` has two parts: the docker-compose integration
  case, and PATH-shim cases (fake `aws`/`rclone`/`curl`/`pg_dump`/`age`) run by
  `backup.test.sh --shim` with no Docker.
- `--backup-dir` must be on the same rclone remote as the destination (rclone
  exits 7 otherwise), so the crypt remote is rooted at the bucket and `files/`
  and `files-trash/` are both paths under it.
- `rclone lsf` on a folder that does not exist yet exits 3; the trash prune
  treats exactly that code as "empty" and fails on any other.
- A source that lists empty while the backup is not is treated as a broken
  source (step `files-sync` fails, nothing is synced) instead of being mirrored
  as "all files deleted".
- `BACKUP_NOW` only works with `BACKUP_TEST_CLOCK_OK=1`, so a stray value in
  production cannot freeze the clock. The daily copy catches up: from 02:00
  Dhaka it is made as soon as today's daily key is missing.
- Deviation from the ticket order: db prunes run before the files sync, so a
  failing files step never skips them. Order is dump, daily copy, db prunes,
  files sync, trash purge, push.
- The `[r2]` remote sets `no_check_bucket = true` so a bucket-scoped R2 token
  (no CreateBucket right) works; the sync excludes `/backups/**` (legacy dumps).
