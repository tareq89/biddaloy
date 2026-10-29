# Backup and disaster recovery

How SchoolManager's database gets backed up, how the nightly staging copy
proves the backups work, how to restore, and what to do about the parts a
database restore doesn't cover (the object store, in-flight background jobs).

> Operator steps (day 0, first deploy, releases, restore commands) live in
> [28-platform-runbook.md](28-platform-runbook.md). This page keeps how backups work.

## The numbers

|                                      |                                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (how much data you can lose) | 1 hour: one backup an hour                                                                                                                                                                      |
| **RTO** (how long a restore takes)   | 4 hours                                                                                                                                                                                         |
| **Retention**                        | 100 hourly + 30 daily database dumps (D2); deleted or changed files stay 30 days in `files-trash/`; logs 180 days                                                                               |
| **Restore proof**                    | Every night: the `restore-drill` job restores the day's backup into a throwaway database, scrubs, migrates and smoke-tests it, then drops it (D5). It never touches the database staging serves |
| **Backup owner**                     | Whoever holds the offline copy of the `BACKUP_AGE_PRIVATE_KEY` for the environment (see "Key handling"). Set this to a real name per environment                                                |

RPO of 1h means: if the database is lost right now, everything written
since the last hourly backup (up to 1 hour ago) is gone.

## How a backup happens

```mermaid
flowchart LR
    db[(prod Postgres)] -->|pg_dump -Fc| dump[dump bytes]
    dump -->|age -r PUBLIC_KEY| enc[encrypted bytes]
    enc -->|aws s3 cp| bucket[("R2 bucket<br/>db/hourly/*.dump.age")]
    files[Uploaded files<br/>in SeaweedFS] -->|rclone sync, encrypted| bucket
```

The prod `backup` container (image `biddaloy-backup`, run by supercronic as uid
10001, `TZ=Asia/Dhaka`) runs `backup.sh` every hour at minute 0. A prod deploy
also runs it once before migrating. Plaintext never touches disk: `pg_dump`,
`age` and `aws s3 cp` are one pipe, and the pipe is the only place the plaintext
exists. Prod holds only the **public** key, so a stolen prod host can write
backups but cannot read them.

### The hourly run to R2

Example key: `db/hourly/20260920T200000Z.dump.age`.

```mermaid
flowchart TD
    start([timer, every hour]) --> dump["pg_dump | age | aws s3 cp<br/>db/hourly/&lt;UTC ts&gt;.dump.age"]
    dump --> h{"Dhaka hour >= 02<br/>and today's daily missing?"}
    h -->|yes| daily["server-side copy to<br/>db/daily/&lt;date&gt;.dump.age"]
    h -->|no| prune
    daily --> prune["prune db: keep 100 hourly,<br/>30 daily"]
    prune --> files["rclone sync SeaweedFS bucket<br/>(not backups/) to r2crypt:files<br/>changed or deleted files go to<br/>files-trash/&lt;date&gt;/"]
    files --> trash["purge trash folders older than 30 days"]
    trash --> push["Uptime Kuma push: up<br/>(any failed step: down + step name, exit non-zero)"]
```

| What                                                           | Where in R2           | Kept for           |
| -------------------------------------------------------------- | --------------------- | ------------------ |
| Hourly database dumps                                          | `db/hourly/`          | 100 (about 4 days) |
| Daily database dumps                                           | `db/daily/`           | 30 (30 days)       |
| Files (contents + names encrypted; top-level folder names too) | `files/`              | current copy       |
| Deleted/changed files                                          | `files-trash/<date>/` | 30 days            |
| Host and container logs (see "The log archive")                | `logs/<date>/`        | 180 days           |

Without the `BACKUP_S3_*` variables (local dev) the container keeps the old
single-key behaviour: one `backups/db/` dump a day at 02:00, pruned by age with
`BACKUP_RETENTION_DAYS`, no files sync. That mode is for development only: its
dumps sit on the same disk as the database. Production always sets all six of
`BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
`BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_RCLONE_CRYPT_PASSWORD`,
`BACKUP_RCLONE_CRYPT_SALT` (all or none).

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
  example `db/hourly/` 72 hours (keep 100, about 100 hours) and `db/daily/` 25 days (keep 30).
  A lock equal to the window breaks: one extra or manual run, or a dump that
  finishes a few seconds faster, makes the prune try to delete a key that is
  still locked. The prune then fails, and because the db prunes run first,
  that run also skips the files sync and the daily prune.

If the network is down at the start, the run probes and waits (up to
`BACKUP_NET_WAIT_SECS`, default 900) instead of failing at once.

## The nightly restore drill proves restores

A backup nobody restores is a hope, not a backup. So every night the host
restores the newest daily prod backup into a **throwaway** database
(`biddaloy_staging_drill`), checks it, and drops it (D5). The database staging
actually serves (`biddaloy_staging_dev` or `biddaloy_staging`, see below) is
never touched, so the drill can fail without hurting anyone using staging.
It replaced the old weekly drill (row counts once a week) and, in Epic 88, the
nightly staging refresh (which swapped a fresh copy into staging every night).

```mermaid
sequenceDiagram
  participant T as systemd timer 02:20
  participant N as biddaloy-nightly restore-drill
  participant J as jobs container (staging)
  participant R as R2 (read-only token)
  participant P as Postgres (staging)
  participant K as Uptime Kuma
  T->>N: start (holds deploy.lock, then swap lock)
  N->>N: guard: at least 1 GB RAM free, else down "not enough memory"
  N->>J: staging-refresh.sh --target biddaloy_staging_drill --from latest-daily
  J->>R: wait for db/daily/TODAY.dump.age (until 02:50)
  J->>R: restore.sh: download, age decrypt, pg_restore
  J->>P: scrub.sql in ONE transaction
  J->>P: verify: schools, users, students not empty
  N->>P: migrate the drill db with the staging app image
  N->>P: smoke: one-off app on the drill db
  N->>P: drop biddaloy_staging_drill
  N->>N: write /opt/biddaloy/staging/last-drill
  N->>K: push up (or down + failed step)
```

A green night looks like this in `/opt/biddaloy/staging/last-drill`
(one line, written only by a clean run, so a failed night leaves yesterday's):

```text
2026-10-29T02:31:07+0600 duration=642s schools=12 users=1480 students=9120
```

`biddaloy-doctor staging` shows it as the `restore drill` line: OK under 26 h,
WARN when older or never recorded.

**What a green night proves:** the newest daily dump downloads, decrypts with
the real private key, `pg_restore` loads it, every personal-data column can be
scrubbed, the current code's migrations run on real prod data, and the app
boots and passes the smoke test on the result.

**What it does not prove:** that the _hourly_ dumps of other hours work (they
are the same pipe, so unlikely to differ), that uploaded **files** can be
restored (the drill restores no files), or that a restore onto an _empty prod_
VM works. That last path is `biddaloy-restore-prod` (below); rehearse it after
any change to it.

If the 02:00 daily is late, the job waits until `STAGING_REFRESH_DEADLINE`
(default 02:50) and then fails with a `down` push. The drill database is
dropped on every exit, so nothing is left behind; if the drop itself fails the
push is `up` with `ok, warning: drill db not dropped` and `last-drill` is not
updated. The swap helper (`scripts/backup/db-swap.sh`) renames by name and
accepts only `biddaloy_staging*` and `biddaloy_demo*` databases, so it can never
touch prod.

### Which database does staging serve? (the active db)

Staging keeps two databases side by side. A one-word state file picks which one
the app uses:

| `/opt/biddaloy/staging/active-db` | Staging serves         | S3 bucket      | Badge in the app header |
| --------------------------------- | ---------------------- | -------------- | ----------------------- |
| missing, empty or `dev` (default) | `biddaloy_staging_dev` | `<bucket>-dev` | `DEV`                   |
| `staging`                         | `biddaloy_staging`     | `<bucket>`     | `STAGING`               |

Any other word fails the next deploy (no guessing a database). The deploy
derives `POSTGRES_DB`, `S3_BUCKET`, `ENV_BADGE` and `ENV_BADGE_DATE` (the date
in `/opt/biddaloy/staging/loaded-backup`, shown only when it is `YYYY-MM-DD`)
from it; they are not operator settings. To load a prod copy into
`biddaloy_staging` by hand use
`staging-refresh.sh --target biddaloy_staging --from latest-daily`
(`--from latest-hourly` or an exact `db/daily|hourly/<name>.dump.age` key also
work; the only allowed targets are `biddaloy_staging` and
`biddaloy_staging_drill`). It drops and recreates the target first, so stop the
app before pointing it at the live database.

### The scrub (D6) and the column guard

Staging must never be able to message a real person or leak one. `scripts/backup/scrub.sql`
runs on the restored copy, in one transaction, before the app ever sees it:

| Data                                                                                                                                                        | What happens                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emails, phones, names, addresses, guardian details, free-text notes                                                                                         | replaced by fakes built from the row id (stable, unique, no original value), or `NULL`, or `'[scrubbed]'` where the column is `NOT NULL` and has a `CHECK` |
| School provider settings and keys, linked sign-in identities, refresh / auth / invoice-share / calendar-feed tokens, push subscriptions, attendance devices | blanked or deleted                                                                                                                                         |
| Passwords                                                                                                                                                   | every user gets the one `STAGING_PASSWORD` hash (`STAGING_PASSWORD_HASH_B64` in `staging.enc.env`)                                                         |
| Emails of platform super admins and of users in the smoke school (`SMOKE_SCHOOL_SLUG`)                                                                      | kept, so you and the smoke test can sign in                                                                                                                |
| Dates of birth                                                                                                                                              | shifted, not removed                                                                                                                                       |
| Religion, blood group                                                                                                                                       | kept: the app behaves differently without them, and alone they identify nobody (revisit if the data-protection review says otherwise)                      |
| Uploaded files                                                                                                                                              | never copied                                                                                                                                               |

Example: guardian phone `01712345678` becomes `+88014` followed by a running
number, still in the Bangladesh mobile shape so validation passes.

**The column guard.** Every column that may hold personal data is listed in
`server/test/staging-scrub-columns.ts`. `server/test/staging-scrub.integration.spec.ts`
runs the exact `scrub.sql` and **fails CI when a new column that may hold
personal data is not on the list**. This is why adding a column to the schema
asks you to decide how it is scrubbed. The password hash is made with the app's
own `hashPassword` (bcrypt cost 12) and carried as base64, because compose
expands every `$` in a `.env` value; `config-check --env staging` decodes it and
verifies it against `STAGING_PASSWORD`.

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

`BACKUP_AGE_PUBLIC_KEY` (encrypts) lives in `prod.enc.env` like any other
variable; it is not a secret. The matching private key is the one thing that
actually matters:

- **Where it lives:**
  1. The master copy is outside the host, in a password manager or vault the
     backup owner controls. Never committed in the clear.
  2. A copy sits in `staging.enc.env` as `BACKUP_AGE_PRIVATE_KEY`. The deploy writes
     it to `/opt/biddaloy/staging/restore/key.txt` (owner 10001, mode 0400), mounted
     read-only into the staging `jobs` container only. It is left out of staging's
     `.env`. Prod never holds it.
- **What that costs.** The VM holds both the private key (in the staging project)
  and read access to the R2 dumps. Someone who takes over the host can read every
  retained dump (100 hourly + 30 daily, about 30 days of history), including rows
  already deleted from the live database. We accept this so the restore proof runs
  on the VM every night and the key never reaches a CI runner. The R2 token staging
  holds is **read-only**, so a compromised staging cannot overwrite or delete a prod
  backup, and it is never given prod's file-crypt password.
- **Rotation:** generate a new keypair (`age-keygen`), put the new public key in
  `prod.enc.env` and the new private key in `staging.enc.env`, and deploy both in the
  same step (otherwise tomorrow's refresh cannot decrypt). New backups from that point
  encrypt to the new key. **No re-encryption of old archives is needed**: keep the old
  private key until no archive it encrypted is left. Do not count days: R2 keeps the
  last 30 daily dumps by count, so a missed run can keep an old-key dump past day 30.
  Before you discard it, list what is left and check that no key is older than the
  rotation date:
  `aws s3 ls s3://<BACKUP_S3_BUCKET>/db/ --recursive --endpoint-url https://<acct>.r2.cloudflarestorage.com`
  (keys carry their date, e.g. `db/daily/2026-10-20.dump.age`).
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

## Restore runbook

Two cases. Pick by what you lost.

```mermaid
flowchart TD
  A["What happened?"] --> B{"The whole VM is gone,<br/>or prod data is lost"}
  A --> C{"Need to look at old data,<br/>or one tenant's files"}
  B --> D["biddaloy-restore-prod<br/>into the EMPTY prod database"]
  C --> E["restore.sh into a scratch database<br/>(never prod)"]
```

### Rebuild prod on a fresh VM: `biddaloy-restore-prod`

Run it once, after `provision` and `biddaloy-deploy all <sha>` have made an
empty prod stack. It restores a chosen R2 dump **in place** into the empty prod
database, copies the uploaded files back, migrates with the prod app image,
checks the counts and prints the next command. It never starts the app: you run
`biddaloy-deploy prod <sha>` afterwards, which backs up, migrates, starts and smokes.

```bash
# the age PRIVATE key: a file owned by uid 10001, mode 0400 or 0600, alone in its own directory
sudo install -d -m 0755 /opt/biddaloy/prod/restore
sudo install -o 10001 -g 10001 -m 0400 age-private-key.txt /opt/biddaloy/prod/restore/key.txt

biddaloy-restore-prod \
  --age-key-file /opt/biddaloy/prod/restore/key.txt \
  --from latest-daily \
  --yes-restore-prod biddaloy_prod
# --from: latest-hourly | latest-daily | db/hourly/<file>.dump.age | db/daily/<file>.dump.age
# optional: --skip-files   --max-age-hours N (default 36)
```

(Use the real value of `POSTGRES_DB` from `/opt/biddaloy/prod/.env` after
`--yes-restore-prod`; you must repeat it exactly.) Delete the key file when
you are done.

```mermaid
flowchart LR
  A["checks: db name repeated,<br/>key file mode/owner/alone in dir,<br/>backup age under limit"] --> B["check-empty: no user,<br/>no school but default-school"]
  B --> C["stop app, app2, backup"] --> D["restore.sh --require-empty<br/>(one transaction)"]
  D --> E["copy files back<br/>(rclone r2crypt:files)"] --> F["migrate with prod image"] --> G["verify counts"]
  G --> H["Next: biddaloy-deploy prod sha"]
```

It refuses (exit 2, nothing modified) unless: the confirmation equals the prod
database name; the key file is a regular file, not a symlink, mode 0400 or 0600,
owned by uid 10001, alone in its directory; the backup is no older than
`--max-age-hours`; and the prod database is **empty** (no user, and no school
besides the migration-made `default-school`). If it finds data it says so and
points you at a normal `biddaloy-deploy prod <sha>`. It takes `deploy.lock` and
then the swap lock, like every nightly job. Every outcome is a line in
`/opt/biddaloy/prod/deploys.log` (`prod restore <key> ok`).

**Why in place and not "restore to `_next`, then swap":** `db-swap.sh` accepts only
staging and demo names, on purpose, so it can never rename prod. The target is
empty by the check above, and the empty check, the schema wipe and the load are
one transaction inside `restore.sh`, so a failure leaves the database exactly as
it was.

### `restore.sh` by hand (inspect old data, never onto prod)

```bash
# 1. Point at the archive and a target database that is NOT production.
#    restore.sh refuses to run if TARGET_DATABASE_URL equals this shell's
#    own DATABASE_URL, precisely to stop this mistake.
export BACKUP_AGE_PRIVATE_KEY_FILE=/path/to/age-key.txt   # never in .env

# R2 form (production dumps). A bare key starting with db/ is read from the
# R2 bucket using BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET / BACKUP_S3_ACCESS_KEY_ID /
# BACKUP_S3_SECRET_ACCESS_KEY (the same vars the backup container has):
export BACKUP_S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com \
       BACKUP_S3_BUCKET=<bucket> BACKUP_S3_ACCESS_KEY_ID=... BACKUP_S3_SECRET_ACCESS_KEY=...
scripts/backup/restore.sh \
  db/hourly/20260920T200000Z.dump.age \
  postgres://postgres:postgres@localhost:5432/biddaloy_restored
```

What it does, in order: download (or read a local file) → `age --decrypt` →
`pg_restore --clean --if-exists --no-owner` → print `scripts/backup/verify.sql`'s
row/tenant counts and the `schools.logo_key` list. It does **not** run migrations:
run `node server/dist/scripts/migrate.js run` from the app image afterwards.

`--require-empty` (what `biddaloy-restore-prod` uses) changes three things: the
target must hold no user and no school besides `default-school` (else **exit 3**,
checked first and again inside the transaction); the restore becomes **one
transaction** (check, `DROP SCHEMA public CASCADE`, `CREATE SCHEMA public`, the dump)
that rolls back on any failure; and `--expect-db <name>` must name the target
database. `--allow-live-target` lets the target equal this environment's
`DATABASE_URL`, but only together with `--require-empty` and `--expect-db`, so the
empty check and the name check are always the protection. See
[`scripts/backup/README.md`](../../scripts/backup/README.md) for every env var.

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

## The log archive

Container logs rotate on the VM (5 files of 20 MB each), so a day of logs must
leave the host before it is lost. Every night at 04:00 `biddaloy-nightly log-archive`
exports yesterday's logs and ships them, encrypted, to R2 (D7).

```mermaid
flowchart LR
  A["docker logs --since 00:00 --until 24:00<br/>per container, plus the host journal"] --> B["/opt/biddaloy/logs-export/&lt;date&gt;/*.log.gz"]
  B --> C["log-archive.sh in the prod jobs container:<br/>rclone copy to r2crypt:logs/&lt;date&gt;/"]
  C --> D["rclone check"] --> E["delete the local export<br/>(only after the check passed)"]
  C --> F["delete logs/ folders older than 180 days"]
```

Logs are redacted at the source ([Rule 13](08-security.md#rule-13-logs-never-carry-secrets)); the
script never opens a log file, it only hands paths to rclone. File names and
contents are encrypted with the same style of rclone crypt as the file backup,
using the `LOG_ARCHIVE_*` settings in the prod `.env` (`prod.enc.env`; each falls
back to the matching `BACKUP_*` value). `biddaloy-nightly log-archive` runs in
the prod `jobs` container, so `edge.enc.env` is not read. The result is the `log-archive-nightly` Kuma push.
To read a day back, build an rclone config as for "Restore files from R2" and run
`rclone copy r2crypt:logs/<date> ./logs-out`.

## Env vars ([15.3.x])

In `infra/secrets/*.example.env` (the committed key lists) and
`.env.example` for development, grouped under "Object storage" and "Backup and
disaster recovery":

| Var                                              | Ticket  | Purpose                                                                                                                                        |
| ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT`                                    | 15.3.1  | Bucket endpoint (SeaweedFS in every environment on the VM)                                                                                     |
| `S3_REGION`                                      | 15.3.1  | Bucket region                                                                                                                                  |
| `S3_BUCKET`                                      | 15.3.1  | Bucket name                                                                                                                                    |
| `S3_ACCESS_KEY_ID`                               | 15.3.1  | Bucket credentials                                                                                                                             |
| `S3_SECRET_ACCESS_KEY`                           | 15.3.1  | Bucket credentials                                                                                                                             |
| `S3_FORCE_PATH_STYLE`                            | 15.3.1  | `true` for SeaweedFS/self-hosted, unset for AWS S3                                                                                             |
| `BACKUP_AGE_PUBLIC_KEY`                          | 15.3.2  | Encrypts new backups (prod)                                                                                                                    |
| `BACKUP_SCHEDULE`                                | 15.3.2  | Cron schedule, `TZ=Asia/Dhaka`. Unset: `0 * * * *` (hourly) in R2 mode, `0 2 * * *` (daily) in legacy mode                                     |
| `BACKUP_RETENTION_DAYS`                          | 15.3.2  | Legacy mode only (no `BACKUP_S3_*`): backups older than this are deleted (default 30)                                                          |
| `BACKUP_S3_ENDPOINT`                             | #1745   | R2 endpoint `https://<acct>.r2.cloudflarestorage.com`. The six `BACKUP_S3_*` / `BACKUP_RCLONE_CRYPT_*` vars are all-or-none                    |
| `BACKUP_S3_BUCKET`                               | #1745   | R2 bucket for `db/`, `files/` and `logs/`                                                                                                      |
| `BACKUP_S3_ACCESS_KEY_ID`                        | #1745   | R2 API token, scoped to the bucket. Prod: read-write. Staging: **read-only**                                                                   |
| `BACKUP_S3_SECRET_ACCESS_KEY`                    | #1745   | R2 API token secret                                                                                                                            |
| `BACKUP_RCLONE_CRYPT_PASSWORD`                   | #1745   | Encrypts file contents and names. Prod only. Store a copy outside the host                                                                     |
| `BACKUP_RCLONE_CRYPT_SALT`                       | #1745   | Second crypt secret (salt). Prod only. Store a copy outside the host                                                                           |
| `BACKUP_PUSH_URL`                                | #1745   | Uptime Kuma push URL, `https://<KUMA_DOMAIN>/api/push/<token>` (`?status=up/down&msg=<step>` appended). Unset = no push                        |
| `BACKUP_HOURLY_KEEP`                             | #1745   | Hourly dumps kept (default 100)                                                                                                                |
| `BACKUP_DAILY_KEEP`                              | #1745   | Daily dumps kept (default 30)                                                                                                                  |
| `BACKUP_TRASH_DAYS`                              | #1745   | Days a deleted file stays in `files-trash/` (default 30)                                                                                       |
| `BACKUP_FILES_MAX_DELETE`                        | #1745   | Files sync refuses to sync (touches nothing) if it would delete more than this many files in one run (default 500)                             |
| `SENTRY_CRON_MONITOR_URL`                        | 15.3.2  | Optional cron check-in                                                                                                                         |
| `BACKUP_AGE_PRIVATE_KEY`                         | Epic 79 | Staging only: the age private key; the deploy writes it to `restore/key.txt`, it is not left in `.env`                                         |
| `BACKUP_AGE_PRIVATE_KEY_FILE`                    | 15.3.3  | Key path inside the container (`/run/age/key.txt`). The key itself is never in a container env; see "Key handling"                             |
| `BACKUP_AGE_KEY_DIR`                             | Epic 79 | Host dir of that key, mounted read-only at `/run/age`. No default; the deploy sets it for staging, `biddaloy-restore-prod` sets it for its run |
| `STAGING_PASSWORD_HASH_B64`                      | Epic 79 | Base64 of the bcrypt (cost 12) hash of `STAGING_PASSWORD`; the scrub sets it on every user                                                     |
| `RESTORE_DRILL_PUSH_URL`                         | Epic 88 | Kuma push URL of the nightly restore drill (staging `.env`). The old name `STAGING_REFRESH_PUSH_URL` is still read for one release             |
| `STAGING_REFRESH_DEADLINE`                       | Epic 79 | `HH:MM` Dhaka time to stop waiting for the daily backup (default `02:50`); the drill uses it too                                               |
| `SMOKE_SCHOOL_SLUG`                              | Epic 79 | The school whose users keep their email in staging (the "Smoke Test School")                                                                   |
| `LOG_ARCHIVE_PUSH_URL`                           | Epic 79 | Kuma push URL of the log archive (prod `.env`)                                                                                                 |
| `LOG_ARCHIVE_KEEP_DAYS`                          | Epic 79 | Days of logs kept in R2 (default 180)                                                                                                          |
| `LOG_ARCHIVE_S3_*`, `LOG_ARCHIVE_RCLONE_CRYPT_*` | Epic 79 | R2 settings for `logs/`; each falls back to the matching `BACKUP_*` value                                                                      |

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

## Learnings (Epic 88, wave 2)

- 2026-10-29: the restore proof moved from "refresh staging every night" to a
  throwaway-database drill. Staging no longer changes under testers at 02:20,
  and a broken backup shows up as a red `restore-drill` monitor instead
  of a stale staging.
- 2026-10-29: `last-drill` is written only after restore, migrate, smoke and
  drop all passed. The doctor trusts that file, not the timer, so a night that
  failed halfway cannot look healthy.
- 2026-10-29: the drill skips itself (down push) below 1 GB of free memory,
  because it restores a whole prod dump next to a running staging (D8).
- 2026-10-29: the push variable was renamed, so the old
  `STAGING_REFRESH_PUSH_URL` is read as a fallback for one release. Rename it in
  `staging.enc.env`, then remove the fallback.
