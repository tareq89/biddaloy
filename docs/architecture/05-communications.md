# Communications (Reminders)

Guardians who haven't paid fees get reminded via SMS, WhatsApp, Messenger,
or email — one guardian at a time, or in bulk across every flagged student
from [04-fees-payments-invoices.md](04-fees-payments-invoices.md#5-flag-overdue-fees-and-remind-guardians).

## Provider adapter pattern

```mermaid
flowchart LR
    CTRL["communications.controller.ts\n(send / reminder/single / reminder/bulk)"]
    REG["CommunicationProviderRegistry\n(picks provider by medium + tenant settings)"]
    IFACE["CommunicationProvider\n(interface: .send())"]
    SMS["SMS\nGreenweb / Mim SMS gateway"]
    WA["WhatsApp\nWhatsApp Cloud API"]
    MSG["Messenger\nprovider"]
    EMAIL["Email\nSMTP"]
    LOG["CommunicationLog\n(one row per message,\nevery medium)"]
    BATCH["ReminderBatch\n(bulk campaign tracking)"]

    CTRL --> REG
    REG --> IFACE
    IFACE --> SMS
    IFACE --> WA
    IFACE --> MSG
    IFACE --> EMAIL
    SMS --> LOG
    WA --> LOG
    MSG --> LOG
    EMAIL --> LOG
    CTRL -.->|"bulk send"| BATCH
    BATCH --> LOG
```

Every channel implements the same `CommunicationProvider` interface
(`modules/communications/providers/communication-provider.interface.ts`), so
the controller/service layer never branches on medium — it asks the
registry for "whatever handles WHATSAPP for this tenant" and calls
`.send()`. Per-tenant provider configuration (which SMS gateway, which SMTP
account, credentials) lives in `School.settings` / the tenant-settings
module, so different schools can use different providers without any code
change.

## Where this deviated from the original plan

The original plan specified **Twilio** for both SMS and WhatsApp. What
shipped instead:

- **SMS** — **Greenweb** and **Mim SMS**, two Bangladeshi SMS gateways
  (`providers/sms/greenweb-sms.gateway.ts`, `.../mim-sms.gateway.ts`),
  selected per-tenant via `sms-provider.factory.ts`. Twilio's per-message
  pricing and lack of local carrier relationships make it a poor fit for a
  Bangladesh-market product; local gateways are both cheaper and more
  reliable for BD phone numbers.
- **WhatsApp** — the **WhatsApp Cloud API** directly (Meta's own API), not
  Twilio's WhatsApp product.
- **Messenger** was added as a full channel, beyond the original three.

## Single vs. bulk sends

- **Single**: `POST communications/reminder/single/:studentId` (with a
  `.../preview` variant to show staff the rendered message before sending).
- **Bulk**: `POST communications/reminder/bulk` creates a `ReminderBatch`
  row up front (tracking the filter used and progress), then fans out to
  one `CommunicationLog` row per recipient as each send completes —
  `GET communications/reminder/bulk/:id` polls that batch's status.

## Delivery tracking & debugging

Every send — success or failure, automated or staff-triggered — gets a
`CommunicationLog` row: recipient, channel, message content, delivery
status, and who/what triggered it (`sent_by` is null for
automatically-triggered sends). This is the first place to look when a
guardian says "I never got the reminder."

`CommunicationLog.status` moves through:

- `QUEUED` — waiting for `CommunicationsProcessor` to pick it up.
- `SENT` — the provider accepted it.
- `FAILED` — permanently failed (bad provider, no retries left, or the
  tenant is suspended — see below); `metadata.reason` / `metadata.error`
  says why.

## Push-first dispatch for routine automated notifications [#555]

"Push" here means a browser/OS notification delivered through the [Web
Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) to a
device the guardian's linked user account has subscribed from (see
`modules/push/`) — not SMS, WhatsApp, Messenger, or email. Free to send
(no gateway cost), so it's tried first for **routine** notifications, with
the guardian's normal preferred channel as the fallback.

**Routine** = `CommunicationLog.trigger === CommunicationTrigger.AUTOMATED`
— today that's only attendance-absence notices
(`absence-notice.scheduler.ts`'s daily sweep, and the same code path when
a class teacher finalizes a register early). A **staff-initiated** send —
one guardian (`SINGLE_REMINDER`), a bulk campaign (`BULK_REMINDER`), or a
freeform message (`MANUAL`) — always goes straight to the guardian's
preferred channel, exactly as before. `ACCOUNT_ACCESS` sends (invites,
OTPs, password resets) are excluded too: a fallback delay is not
acceptable for those.

```mermaid
flowchart TD
    Q["CommunicationsProcessor.process(job)\n(after the tenant-suspension check)"] --> R{"log.trigger ==\nAUTOMATED?"}
    R -->|no| PREF["Send via log.medium\n(unchanged — staff picked this channel)"]
    R -->|yes| U{"Guardian has a\nlinked user\n(guardian.user_id)?"}
    U -->|no| PREF
    U -->|yes| PUSH["PushService.sendToUser(userId, tenantId, payload)"]
    PUSH --> A{"accepted >= 1?"}
    A -->|yes, STOP| DONE["Rewrite this log:\nmedium = PUSH\nrecipient_address = push:&lt;user_id&gt;\nmetadata = {accepted, transient, pruned}\nstatus = SENT\n(one CommunicationLog row — no SMS/email log created)"]
    A -->|no, fall through| PREF
```

Decision table (opt-out is checked upstream — see
`reminder-recipients.util.ts#partitionByOptOut` — and stays authoritative:
an opted-out guardian never gets a `CommunicationLog` row queued at all,
so it never reaches this table):

| Trigger                                                           | Guardian has linked user + push subscription? | Push result      | What gets logged / sent                                                          |
| ----------------------------------------------------------------- | --------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `AUTOMATED` (routine)                                             | No                                            | —                | Preferred channel, unchanged (SMS/WhatsApp/Email)                                |
| `AUTOMATED` (routine)                                             | Yes                                           | `accepted >= 1`  | **One** `CommunicationLog` (`medium = PUSH`) — preferred channel is **not** sent |
| `AUTOMATED` (routine)                                             | Yes                                           | `accepted === 0` | Falls back to preferred channel, unchanged                                       |
| `MANUAL` / `SINGLE_REMINDER` / `BULK_REMINDER` / `ACCOUNT_ACCESS` | irrelevant                                    | —                | Preferred channel, unchanged — never tried via push                              |

Example: a guardian with the app installed as a PWA on their phone gets an
absence notice as a push notification instead of an SMS. A `push` medium
log for them looks like:

```json
{
  "medium": "PUSH",
  "recipient_address": "push:3f2a1c9e-...-user-id",
  "metadata": { "accepted": 1, "transient": 0, "pruned": 1 },
  "status": "SENT"
}
```

No push endpoint or subscription key ever lands in `CommunicationLog` —
only which user it went to and the accept/transient/pruned counts
`PushService.sendToUser` returned (see `modules/push/push.service.ts`).

For VAPID key generation, storage, and rotation cost, see
[`12-operations.md` §5 Web push](12-operations.md#5-web-push-vapid-keys).

`medium = 'PUSH'` is a value only `communication_logs.medium`'s own DB
enum accepts (`communication_logs_medium_enum`,
migration `1789400000000-AddPushCommunicationMedium.ts`) — it is
deliberately **not** part of the shared `CommunicationMedium` enum used
elsewhere (e.g. `guardian.preferred_communication`), because a guardian
can never _choose_ push as a preferred channel the way they can choose
SMS or email.

When push is accepted instead of SMS, the SMS credit reserved for that
log (fee, payment-receipt and calendar notices reserve credit and carry
`batchId` + `segments` in the job) is **released** (`settlePart(..., 'RELEASE')`,
`metadata.credit = RELEASED`), because no SMS goes out. Logs with no
reservation (unmetered tenant, no `batchId`) touch nothing.

## Suspended tenants: queued work is cancelled, not paused

A school (tenant) can be suspended by a SUPER_ADMIN
(`TenantStatusService`, `server/src/modules/schools/tenant-status.service.ts`).
`CommunicationsProcessor.process()` checks `tenantStatus.isActive(tenantId)`
before doing anything else — no provider call, no SMS credit debit for a
suspended tenant:

```mermaid
sequenceDiagram
    participant Q as BullMQ job
    participant P as CommunicationsProcessor
    participant T as TenantStatusService
    participant Prov as SMS/WhatsApp/Email provider

    Q->>P: process(job)
    P->>T: isActive(tenantId)
    alt tenant suspended
        T-->>P: false
        P->>P: log.status = FAILED\nmetadata.reason = "TENANT_SUSPENDED"
        P-->>Q: return (no throw, no retry)
    else tenant active
        T-->>P: true
        P->>Prov: send(message)
        Prov-->>P: result
    end
```

**Important:** this cancels the job, it does not pause it. A message
queued while a school is suspended ends up `FAILED` with
`metadata.reason = "TENANT_SUSPENDED"` and stays that way — reactivating
the school does **not** automatically resend it. Example: a bulk fee
reminder queues 200 `CommunicationLog` rows, the school gets suspended
mid-batch, and 80 rows haven't been picked up by a worker yet — those 80
end up `FAILED`. When the school is reactivated, staff have to trigger a
new send (single or bulk) for anyone who still needs the reminder.

## SMS credit settlement [15.6.6/#549]

A metered tenant's bulk SMS send **reserves** credits for the whole batch
up front (`batch:<batchId>`, epic #508's `RESERVE` ledger kind — see
[the credits doc/#546] for the batch-level reservation). Each individual
SMS job then **settles its own slice** of that reservation, once, right
after the provider call returns — this is the part this section documents.

```mermaid
flowchart TD
    P["Provider call returns"] --> O{"result.outcome"}
    O -->|ACCEPTED| D["DEBIT\nsettlePart(..., 'DEBIT')\nmetadata.credit = DEBITED"]
    O -->|REJECTED| R["RELEASE\nsettlePart(..., 'RELEASE')\nmetadata.credit = RELEASED"]
    O -->|AMBIGUOUS| U["stays RESERVED\nno settlePart call\nmetadata.credit = UNSETTLED\nSentry tag needs_reconciliation"]
    S["Tenant suspended\n(no provider call)"] --> R
```

| Provider outcome             | Meaning                                                                             | Ledger kind | Balance effect                                  | `metadata.credit` |
| ---------------------------- | ----------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- | ----------------- |
| `ACCEPTED`                   | Provider took the message                                                           | `DEBIT`     | `reserved -= segments`, credits spent           | `DEBITED`         |
| `REJECTED`                   | Provider (or a pre-flight check) definitely refused it — 4xx/validation, never sent | `RELEASE`   | `reserved -= segments`, `available += segments` | `RELEASED`        |
| `AMBIGUOUS`                  | Timeout/5xx/unknown error _after_ the request went out — unclear if it was sent     | none        | untouched — stays reserved                      | `UNSETTLED`       |
| Tenant suspended before send | No provider call was made                                                           | `RELEASE`   | `reserved -= segments`, `available += segments` | `RELEASED`        |

A **post-acceptance delivery failure** (the SMS was accepted by the
gateway but never reaches the handset — bad number on the carrier side,
etc.) is **not** one of these outcomes: it's invisible to this processor,
which only sees the gateway's immediate accept/reject response. It stays
billed — this mirrors how a real carrier charges: you pay to hand the
message to the network, not for confirmed handset delivery.

### Key convention (#1317)

Every metered-SMS producer follows one rule, so the worker can find the
reservation it settles:

```mermaid
flowchart LR
    P["Producer picks a bare batchId\nfee-notify:G1:sms"] -->|"reserve key"| R["RESERVE\nbatch:fee-notify:G1:sms"]
    P -->|"job data"| J["{ logId, batchId: fee-notify:G1:sms, segments }"]
    J --> W["Worker settlePart(\nbatch:fee-notify:G1:sms,\nlog:LOG_ID)"]
    R -.same key.- W
```

| Producer              | Bare `batchId` (job) / reserve key = `batch:` + it |
| --------------------- | -------------------------------------------------- |
| Bulk reminders        | `<batch.id>`                                       |
| Calendar notify       | `<batch.id>`                                       |
| Incident SMS          | `incident:<incidentId>`                            |
| Fee notification      | `fee-notify:<feeGenerationId>:sms`                 |
| Payment receipt       | `payment-notify:<paymentId>:<guardianId>`          |
| Invoice send (manual) | `invoice-send:<invoiceId>:<guardianId>:<sendId>`   |
| Exam result SMS       | `exam-result-sms:<examId>:<sendId>`                |

Rules:

- A manual re-send gets its own `sendId` (and its own `reference_id`), so
  each send reserves and is capped on its own.
- `CommunicationsService.enqueue` releases the reservation itself when no job
  will ever exist: the log save or lookup throws (`enqueue-failed:<uuid>` part
  key) or `queue.add` throws (`log:<id>`). The exam-result loop does the same
  per job: a failed log save releases under `enqueue-failed:<uuid>`, a failed
  `queue.add` under `log:<id>`, and the loop carries on with the next job.
- The fee and payment listeners do **not** release on a `queue.add` failure.
  The log is marked `ENQUEUE_FAILED` and a replayed event re-claims that same
  log id, so the units stay held for the replay's settle. Releasing would make
  the re-sent SMS free.

### Reconciling stranded reservations (#1317)

Before the fix, fee, payment-receipt, invoice-send and exam-result reservations
were made under a key the worker never looked up (no `batch:` prefix). Their
units stayed in `reserved` forever. An operator command finds them and settles
the ones whose outcome is certain. It is **not** a migration and never runs on
boot: you start it by hand.

Run it **after** the fix is deployed **and** the communications queue has
drained (in-flight rows are skipped, so an early run is safe but incomplete).

**Deploy note:** drain or stop the communications workers before (or while)
deploying the producers. A rolling deploy lets an OLD worker handle a NEW-key
job (for example by push-delivering it), which leaves units reserved under a
`batch:` key. Run the dry-run afterwards: such rows show up as
`BATCH_REMAINDER`.

```bash
cd server && yarn sms-credit:reconcile                          # dry run, all tenants (default)
cd server && yarn sms-credit:reconcile --tenant=<uuid>          # dry run, one tenant
cd server && yarn sms-credit:reconcile --tenant=<uuid> --apply --confirm-db=<database name>  # act, one tenant
```

It connects with `DATABASE_URL` from `.env`, like `settings:reencrypt`, but an
already-exported `DATABASE_URL` wins over `.env`. So `--apply` is refused
(exit 2) unless `--confirm-db=<name>` equals the database it actually
connected to (the `database=` value on the first output line; a dry run
shows it). Dry runs need no confirmation.

How each linked SMS log is decided (the log's own `log:<id>` part key is used,
the same one the worker uses, so a re-run or a late worker can never charge or
credit twice):

```mermaid
flowchart TD
    L["Linked SMS log"] --> S{"log:ID:settle\nalready in ledger?"}
    S -->|yes| AS["ALREADY_SETTLED\n(--apply fixes metadata.credit only)"]
    S -->|no| Q{"status QUEUED?"}
    Q -->|yes| IF["IN_FLIGHT: untouched"]
    Q -->|no| E{"ENQUEUE_FAILED?"}
    E -->|yes| M1["MANUAL_REVIEW\nENQUEUE_FAILED_REPLAYABLE"]
    E -->|no| ST{"status"}
    ST -->|"SENT / DELIVERED / READ"| D["DEBIT"]
    ST -->|"FAILED: tenant suspended,\nno provider, invoice enqueue failed"| R["RELEASE"]
    ST -->|"any other FAILED"| M2["MANUAL_REVIEW\nFAILED_OUTCOME_UNKNOWN"]
```

Example dry run (made-up ids; only ids, counts and codes are printed, never
keys, phones, names or message text):

```text
sms-credit:reconcile mode=DRY-RUN database=biddaloy
tenant=0a1b... reserve=7c2d... source=FEE_NOTIFY log=91ef... units=2 action=DEBIT reason=SENT
tenant=0a1b... reserve=7c2d... source=FEE_NOTIFY log=44aa... units=1 action=RELEASE reason=TENANT_SUSPENDED
tenant=0a1b... reserve=7c2d... source=FEE_NOTIFY log=5be0... units=1 action=MANUAL_REVIEW reason=FAILED_OUTCOME_UNKNOWN
tenant=0a1b... stranded_reserves=1 settled_reserves=0 debit=1/2u release=1/1u manual=1/1u already_settled=0 in_flight=0 errors=0
```

`MANUAL_REVIEW` rows are only listed, never touched. They keep their units
reserved until a person decides:

| Reason                         | Meaning                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FAILED_OUTCOME_UNKNOWN`       | FAILED but we cannot tell rejected from ambiguous on old rows                                                                                                                                                                          |
| `ENQUEUE_FAILED_REPLAYABLE`    | A replayed event re-claims this log; releasing would make the re-send free                                                                                                                                                             |
| `ENQUEUE_FAILED_HOLDING_UNITS` | Same, on a post-fix `batch:` reservation. Listed only                                                                                                                                                                                  |
| `AMBIGUOUS_LINK`               | Invoice-send reserve has no single matching log (time-window match)                                                                                                                                                                    |
| `NO_LOG_LINK`                  | Exam-result reserve: logs carry no link to the reservation                                                                                                                                                                             |
| `SHARED_REFERENCE`             | Old invoice-send reserves for one invoice share a reference, so their caps mix; never settled. (Result SMS has one reserve per exam key, so it is never a group.) Reported once per group, as the units not yet settled (any key form) |
| `BATCH_REMAINDER`              | A `batch:` reserve older than 24h with units left and no QUEUED SMS log since: crashed worker, push-delivered by an old worker, or a rolling deploy. Listed only                                                                       |
| `SPLIT_ACROSS_DEPLOY`          | Both an old and a `batch:` reserve exist for the same send; their caps would mix                                                                                                                                                       |
| `EXCEEDS_RESERVATION`          | Settling this log would pass the reserved units                                                                                                                                                                                        |
| `ORPHAN_UNITS`                 | Reserved units no log accounts for                                                                                                                                                                                                     |
| `UNKNOWN_KEY`                  | Reserve key matches no known producer                                                                                                                                                                                                  |

Legacy fee and payment SMS that were delivered by **push** (not SMS) have no
SENT log to debit, so their reserved units show up as `ORPHAN_UNITS`. That is
manual review too.

Safe to re-run: settled rows show as `ALREADY_SETTLED` and nothing is written
twice. The exit code is 1 if any row ended in `ERROR`, 2 for bad arguments.

### Where settlement happens, and why it's outside the log-save transaction

`CommunicationsProcessor.settle()` (the log-save + batch-counter update)
already runs in one DB transaction — see its doc comment. Credit
settlement is a **separate, later** step, deliberately **not** part of
that transaction: a `SmsCreditService.settlePart` failure must never roll
back (or block recording) a send that already happened. If it fails, the
processor logs the error and writes `metadata.credit = 'UNSETTLED'`
instead of throwing — throwing here would risk BullMQ retrying a job
whose SMS was _already sent_, resending it to the guardian a second time.

### Idempotency and the retry/crash window

`settlePart(tenantId, batchKey, logKey, units, outcome)` is idempotent on
`` `${logKey}:settle` `` (`log:<logId>:settle`) — a second call with the
same key is a no-op. Since every settlement call in the processor uses
the same `log:<logId>` key regardless of how many times that job runs,
a BullMQ retry or stalled-job replay settles at most once.

This does **not** close the existing duplicate-send crash window
documented on `CommunicationsProcessor` itself: if the worker crashes
_after_ the provider accepts the message but _before_ the log save
commits, a replay resends the SMS (the log's status guard only catches a
replay _after_ that save landed). What settlement adds: if that same
crash happens after the provider call but before this class gets a chance
to run `settlePart`, the reservation for that log is left in its original
"neither debited nor released" state. The next time this job is
processed, it goes through the outcome mapping again and settles
normally — so the crash window is closed for credit-correctness the same
way it already is for the log/batch state. The `AMBIGUOUS` case is the
one that's expected to require a human: reconciliation tooling looks for
`metadata.credit = 'UNSETTLED'` and the `needs_reconciliation` Sentry tag
(reusing 15.1.4's queue-failure telemetry — see
`CommunicationsProcessor.flagAmbiguousSettlement`) to find these and
resolve them manually.
