# Backup and disaster recovery

How Biddaloy's database gets backed up, how to restore it, and what to do
about the parts a database restore doesn't cover (the object store,
in-flight background jobs).

## The numbers

| | |
|---|---|
| **RPO** (how much data you can lose) | 24 hours — one backup a day |
| **RTO** (how long a restore takes) | 4 hours |
| **Retention** | 30 days of daily backups |
| **Drill cadence** | Quarterly — run [`restore-drill.yml`](../../.github/workflows/restore-drill.yml) manually |
| **Backup owner** | Whoever holds the `BACKUP_AGE_PUBLIC_KEY`/private-key pair for the environment (see "Key handling" below) — set this to a real name/role per environment |

RPO of 24h means: if the database is lost right now, everything written
since the last nightly backup (up to 24 hours ago) is gone. If that's not
acceptable for your environment, shorten `BACKUP_SCHEDULE` (`.env.example`)
— the tradeoff is more `pg_dump` load on `db` and more objects to retain.

## How a backup happens

```mermaid
flowchart LR
    db[(Postgres db)] -->|pg_dump -Fc| dump[dump bytes]
    dump -->|age -r PUBLIC_KEY| enc[encrypted bytes]
    enc -->|aws s3 cp| bucket[(S3 bucket<br/>backups/db/*.dump.age)]
    logos[Live app writes<br/>e.g. school logos] -.->|StorageService.put| bucket
```

Two independent things land in the same bucket, and that's the key fact
this whole doc is built around:

- **`backups/db/*.dump.age`** — a snapshot, written once a day by
  [`scripts/backup/backup.sh`](../../scripts/backup/backup.sh). Consistent
  as of the moment `pg_dump` ran.
- **Everything else** (e.g. `tenants/<id>/logos/*.png`, written by
  `StorageService` — see `server/src/modules/storage/`) — live, current
  right now, never "backed up" in the pg_dump sense because it was never
  in Postgres to begin with. The bucket itself *is* the durable copy.

**Consistency rule:** after a restore, the database reflects yesterday's
world and the bucket reflects today's. A row can reference an object key
that didn't exist yet at backup time (fine — it exists now) or, if an
object was deleted between the backup and now, a row can reference a key
that's gone. `scripts/backup/verify.sql` prints every `schools.logo_key`
value after a restore specifically so an operator can spot-check which of
those went missing — see the restore runbook below.

Plaintext dump bytes never touch disk — `backup.sh`'s three commands
(`pg_dump` → `age` → `aws s3 cp`) are one pipe, and the pipe is the only
place the plaintext exists.

## Key handling

`BACKUP_AGE_PUBLIC_KEY` (encrypts) lives in `.env`/deploy config like any
other env var — it's not a secret. The matching private key
(`BACKUP_AGE_PRIVATE_KEY_FILE`, used by `restore.sh`) is the one thing that
actually matters:

- **Where it lives:** outside the host entirely — a password manager or
  secrets vault the backup owner controls, never committed, never in
  `.env`. Nothing that runs `backup.sh` needs it; only a human running
  `restore.sh` does.
- **Rotation:** generate a new keypair (`age-keygen`), point
  `BACKUP_AGE_PUBLIC_KEY` at the new public half, deploy. New backups from
  that point encrypt to the new key. **No re-encryption of old archives is
  needed** — keep the old private key around until every archive it
  encrypted has aged out of `BACKUP_RETENTION_DAYS` (30 days by default),
  then discard it.
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
```

What it does, in order: download (or read a local file) → `age --decrypt`
→ `pg_restore --clean --if-exists --no-owner` → run server migrations
against the target → print `scripts/backup/verify.sql`'s row/tenant counts
and the `schools.logo_key` list. See
[`scripts/backup/README.md`](../../scripts/backup/README.md) for every env
var it reads.

Then: reconcile `communication_logs` (above), and spot-check any
`logo_key` the verify output printed against the bucket if you suspect
objects were lost around the same incident.

## Env vars ([15.3.x])

All in `.env.example`, grouped under "Object storage" and "Backup and
disaster recovery":

| Var | Ticket | Purpose |
|---|---|---|
| `S3_ENDPOINT` | 15.3.1 | Bucket endpoint (MinIO in dev, your provider in prod) |
| `S3_REGION` | 15.3.1 | Bucket region |
| `S3_BUCKET` | 15.3.1 | Bucket name |
| `S3_ACCESS_KEY_ID` | 15.3.1 | Bucket credentials |
| `S3_SECRET_ACCESS_KEY` | 15.3.1 | Bucket credentials |
| `S3_FORCE_PATH_STYLE` | 15.3.1 | `true` for MinIO/self-hosted, unset for AWS S3 |
| `BACKUP_AGE_PUBLIC_KEY` | 15.3.2 | Encrypts new backups |
| `BACKUP_SCHEDULE` | 15.3.2 | Cron schedule the `backup` service runs on (default `0 2 * * *`, `TZ=Asia/Dhaka`) |
| `BACKUP_RETENTION_DAYS` | 15.3.2 | Backups older than this are deleted (default 30) |
| `SENTRY_CRON_MONITOR_URL` | 15.3.2 | Optional cron check-in |
| `BACKUP_AGE_PRIVATE_KEY_FILE` | 15.3.3 | Decrypts for `restore.sh` — never in `.env`, see "Key handling" |
