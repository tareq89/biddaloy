# Backend Modules

All server code lives in `server/src/modules/*`, one NestJS module per
folder. All routes are served under `/api/v1/...` (see the root README's
"API Versioning" section for the versioning/deprecation policy).

```mermaid
flowchart LR
    subgraph Identity
        auth["auth\nlogin/refresh/logout"]
        users["users\nUser + Teacher CRUD"]
        schools["schools\ntenant + settings\n(no public CRUD API yet)"]
    end
    subgraph Academics
        academics["academics\nAcademicYear controller"]
        classes["classes\nClass + ClassSection"]
        students["students\nStudent + Guardian + bulk upload"]
        enrollments["enrollments"]
        attendance["attendance\nregisters, corrections,\ndevice ingest"]
        calendar["calendar\nevents, terms, import/export,\nICS feed, public holidays"]
    end
    subgraph Money
        fees["fees\nFeeStructure, generation,\ndues, payments"]
        invoices["invoices"]
    end
    subgraph Ops
        communications["communications\nreminders, adapters"]
        audit["audit\nread-only log viewer"]
        health["health\n/api/health"]
    end
    subgraph Timetabling
        routines["routines\nshifts, rooms, routine slots,\nsubstitutions, change requests"]
    end

    auth --> users
    students --> classes
    students --> fees
    fees --> invoices
    fees --> communications
    attendance --> classes
    attendance --> communications
    calendar --> attendance
    calendar --> communications
    routines --> classes
    routines --> academics
    routines --> attendance
```

## Module reference

| Module           | Owns                                                                                                                                                    | Key routes (all under `/api/v1/`)                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | Login, refresh-token rotation, logout, access-token denylist, login lockout                                                                             | `POST auth/login`, `POST auth/refresh`, `POST auth/logout`, `POST auth/logout-all`                                                                                                                                  |
| `users`          | `User` + `Teacher` CRUD                                                                                                                                 | `POST/GET/PATCH/DELETE users`, `POST/GET/PATCH teachers`                                                                                                                                                            |
| `schools`        | `School` (tenant) entity + per-tenant settings (comms provider config, currency, etc.)                                                                  | Internal service only today — no public controller yet                                                                                                                                                              |
| `academics`      | `AcademicYear` (no longer owns holidays — see `calendar`)                                                                                               | `POST/GET/PATCH/DELETE academic-years`, `POST academic-years/:id/set-current`                                                                                                                                       |
| `classes`        | `Class` + `ClassSection`                                                                                                                                | `POST/GET/PATCH/DELETE classes`, nested `.../sections` routes                                                                                                                                                       |
| `students`       | `Student`, `Guardian`, Excel bulk upload                                                                                                                | `POST/GET/PATCH/DELETE students`, `POST students/bulk-upload`, `POST/GET/PATCH/DELETE guardians`                                                                                                                    |
| `enrollments`    | `Enrollment` history                                                                                                                                    | `POST enrollments`, `GET enrollments/student/:studentId`, `PATCH enrollments/:id`                                                                                                                                   |
| `attendance`     | `AttendanceSession`/`Record`, corrections, summaries, auto-absent notices, device ingest                                                                | `GET attendance/my-sections`, `PUT attendance/sections/:id/register`, `PATCH attendance/records/:id`, `GET attendance/flags/low`, `POST attendance/device-events` — see [11-attendance.md](11-attendance.md)        |
| `fees`           | `FeeStructure`, fee generation engine, dues/flagging, `Payment` + allocations                                                                           | `POST/GET/PATCH/DELETE fee-structures`, `POST fees/generate`, `GET fees/dues`, `GET fees/dues/flagged`, `POST payments`, `POST payments/record-with-allocation`                                                     |
| `invoices`       | `Invoice`                                                                                                                                               | `POST/GET invoices`, `GET invoices/:id/print`                                                                                                                                                                       |
| `communications` | `CommunicationLog`, `ReminderBatch`, provider adapters                                                                                                  | `POST communications/send`, `POST communications/reminder/single/:studentId`, `POST communications/reminder/bulk`                                                                                                   |
| `calendar`       | `CalendarEvent`, `AcademicTerm`, `CalendarEventClass`, `CalendarFeedToken`, `PublicHolidaySet` — see [16-academic-calendar.md](16-academic-calendar.md) | `POST/GET/PATCH/DELETE calendar/events`, `POST/GET academic-terms`, `POST calendar-import/validate`, `POST calendar-import/commit`, `GET calendar/feed`, `GET calendar/feed/:token.ics`, `GET/POST public-holidays` |
| `grading`        | `GradingScale`, `GradingBand`, band-validation, recompute preview/confirm — see [01-domain-model.md](01-domain-model.md#grading-modulesgrading)         | `POST/GET/PATCH/DELETE grading/scales`, `POST grading/scales/:id/copy`, `POST grading/scales/:id/bands/preview`, `POST grading/scales/:id/bands/confirm` (approval-gated)                                           |
| `audit`          | Read access to `AuditLog`                                                                                                                               | `GET audit`                                                                                                                                                                                                         |
| `health`         | Liveness check, version-neutral                                                                                                                         | `GET /api/health`                                                                                                                                                                                                   |
| `routines`       | `Shift`, `PeriodSlot`, `Room`, `Routine`, `RoutineSlot`, `RoutineSlotTeacher`, `RoutineSubstitution`, `RoutineChangeRequest` — see below                | `POST/GET/PATCH/DELETE routines/shifts`, `PUT routines/shifts/:id/period-slots`, `POST/GET routines/rooms`, `POST/GET routines`, `POST/GET routines/:id/slots`, `PATCH/DELETE routines/slots/:slotId`, `POST routines/:id/submit-for-review`, `POST routines/:id/publish`, `GET routines/resolve`, `POST routines/substitutions`, `POST routines/slots/:slotId/change-requests` |

## Routines module

`server/src/modules/routines/` (Epic 21.0, class routine/timetable). Owns
the eight entities in
[01-domain-model.md](01-domain-model.md#class-routines--timetables-modulesroutines)
and one service per concern rather than one god-service:

```mermaid
flowchart TD
    shiftsSvc["ShiftsService\n+ PeriodSlotsService"] -->|"day layout"| slotsSvc
    roomsSvc["RoomsService"] -->|"optional room per slot"| slotsSvc
    slotsSvc["RoutineSlotsService\n(create/update/delete a slot)"] -->|"every write"| constraintCheck["ConstraintCheckService\n(hard-constraint validation)"]
    constraintCheck -->|"blocks a save on violation"| slotsSvc
    greedyFill["GreedyFillService\n(fills empty slots)"] --> slotsSvc
    stateSvc["RoutineStateService\n(DRAFT to REVIEW to PUBLISHED)"] --> slotsSvc
    resolveSvc["ResolveRoutineService\n(GET /routines/resolve)"] -->|"reads"| slotsSvc
    resolveSvc -->|"applies dated overrides"| subsSvc["SubstitutionsService"]
    changeReqSvc["ChangeRequestsService"] -->|"targets a published slot"| slotsSvc
    workloadSvc["WorkloadService\n(periods/teacher/day)"] -->|"reads"| slotsSvc
    copySvc["CopyRoutineService\n(copy a routine to a new year)"] --> slotsSvc
```

- **`ConstraintCheckService`** is the hard-constraint gate (D1 below): a
  teacher can't be in two places at once, a section can't have two subjects
  in one slot. It runs on every slot write and blocks the save with a 409
  rather than silently overwriting.
- **`ResolveRoutineService`** (`GET routines/resolve`) is the one place
  recurrence (weekly/biweekly/monthly), effective dating
  (`valid_from`/`valid_to`), weekly-off/holiday exclusion, and dated
  substitutions all get resolved into "what actually happens on this date" —
  every agenda view (`/routines/my`, `/portal/routine`) calls this instead
  of re-deriving any of that logic client-side.
- **`RoutineStateService`** enforces the one-way-ish lifecycle: a change on
  a _published_ routine must go through a `RoutineChangeRequest`, never a
  direct edit — see `RoutineChangeRequest`'s entry in the domain-model doc.

### Deferred, with context

Copied from Epic 21.0's own tracking issue (#783) so a future reader doesn't
need to open GitHub to find out why something obviously useful isn't here
yet.

- **Auto-generating the routine (a real constraint solver).** Deliberately
  not built (D1). The pain in a 30-teacher school is errors, not typing, and
  the binding constraints are political and invisible to a model — senior
  teacher gets mornings, these two must never be adjacent. Schools that run
  solvers hand-fix a large slice of the output. What ships instead:
  hard-constraint validation plus a greedy fill for empty slots. **Trigger
  to revisit:** a school with 40+ sections says manual entry is unworkable.
  **Hooks left:** the constraint values already live in
  `TenantSettings.routine` (D19), and the greedy fill is its own service, so
  a solver replaces one function rather than a subsystem.
- **Drag-and-drop grid editing.** Deferred, not rejected (D17). The keyboard
  model has to exist first because it is the accessibility gate; drag layers
  on top of it cleanly and the reverse never happens.
- **Projecting routine slots into `calendar_events`.** #701 left
  `external_refs jsonb` for exactly this and forbade RRULE on the calendar
  side. Additive later. Note `calendar_event_classes` is class-level —
  projecting a section-level routine needs the nullable `section_id` #701
  already flagged as additive.
- **Google Calendar push.** #701 claims routine depends on it; backwards
  (D5) — it is a consumer. Needs a Google Cloud project, OAuth consent, a
  Workspace admin decision and guardian emails, which many BD guardians do
  not have.
- **Period attendance auto-created from the routine.**
  `AttendanceSession.period_no` and `subject_id` already exist and nothing
  populates them meaningfully. This epic ships the resolver (D14) that
  makes it possible; whether attendance auto-creates sessions is a policy
  call belonging to **Epic 41.0**.
- **Online class links per slot** (Epic 37.0) and **homework note per slot**
  (Epic 22.0). Both hang off a routine slot; the resolver returns slot ids,
  which is all either needs.
- **Printing routine sheets** — Epic 32.0's document service.
- **"Your first class is at 10" notifications.** #701 deferred reminders
  generally, pending demand; same call here.
- **Exam routine** — D13; its own issue on Epic 19.0 once `Exam` exists.

## Cross-cutting `common/`

`server/src/common/` holds code every module leans on, not owned by any one
feature:

- **`decorators/api-tenant-auth.decorator.ts`** — the `@ApiTenantAuth()`
  bundle every tenant-scoped controller applies (see
  [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md)).
- **`decorators/sanitize-text.decorator.ts`** — strips/allowlists HTML from
  free-text input fields (guardian notes, reminder messages, etc.).
- **`rate-limit/`** — per-route throttling tiers, backed by a fail-open
  Redis storage (rate limiting fails _open_, not closed — a Redis outage
  degrades protection but never takes the API down).
- **`filters/http-exception.filter.ts`** — the single place every uncaught
  exception becomes a consistent JSON error body.
- **`request-context.util.ts`** — per-request context (current tenant,
  user, role) threaded through services without prop-drilling it manually.

## API versioning

All routes are served under `/api/v1/` (`main.ts`'s `enableVersioning`, URI
style — visible in logs, curl-able, cacheable, and trivially routable at
nginx via a broad `location /api/` prefix match, no rewrite needed).
`/api/health` is version-neutral (`@Version(VERSION_NEUTRAL)` on
`AppController.health`) and stays reachable at that exact path regardless of
version bumps, so orchestrator health checks never break on one.

`server/src/api-versioning.ts` is the single place that knows the current
version string, read by both `main.ts` and `server/test/helpers/e2e-app.helper.ts`.
That covers today's single-version setup (every route is `1` by default);
it is **not** by itself enough to run two versions side by side — see below.

### Deprecation policy

Introducing `/api/v2/...` while `/api/v1/...` stays live is not a one-line
change: `enableVersioning`'s `defaultVersion` would need to become `['1',
'2']`, and every route whose v2 behavior differs from v1 needs an explicit
`@Version('1')` (or `'2'`) so the two don't collide on the same handler.
There's no code for this yet — it's written up here so the first real bump
follows a plan instead of improvising one under pressure:

- `/api/v2/...` is added alongside `/api/v1/...` — routes are never removed
  in the same change that adds their replacement.
- `/api/v1/...` stays live for **at least 90 days** after `/api/v2/...`
  ships, giving the first-party SPAs (the only current consumers) a full
  sprint-scale window to migrate.
- Once a removal date is set, deprecated (`/api/v1/...`) responses carry a
  `Deprecation` header per [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html)
  (a structured Unix timestamp, e.g. `Deprecation: @1735689600`) and a
  `Sunset` header per [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html)
  (an HTTP-date, e.g. `Sunset: Thu, 01 Jan 2026 00:00:00 GMT`), so any
  consumer — including a future third-party one — can detect the
  deprecation programmatically without reading docs.
- The bump and its sunset date are announced in this section and in the
  epic/issue tracking the migration — there's no separate public changelog
  yet.

## API documentation (Swagger)

Interactive docs (`server/src/swagger.ts`, `server/src/docs-auth.ts`) are
reachable at **`/api/docs`** — version-neutral, like `/api/health`, so the
docs URL doesn't move on a version bump. The bearer scheme and the
`X-Tenant-ID`/`X-Role` header contract (see `ApiTenantAuth` in
`server/src/common/decorators/`) are documented on every guarded
controller, so "Try it out" works once you paste in a token.

**Gating** (`shouldMountDocs` in `swagger.ts`):

- Outside production, docs always mount, unauthenticated — nothing sensitive
  about a dev environment's own API shape.
- In production, docs are off by default: the route doesn't exist (a real
  404, not a rejection) unless `ENABLE_API_DOCS=true` is set.
- With `ENABLE_API_DOCS=true` in production, the route is additionally
  gated by Basic Auth (`API_DOCS_USER`/`API_DOCS_PASSWORD`, both required —
  the app refuses to boot with `ENABLE_API_DOCS=true` and no credentials
  set, rather than silently serving the docs unauthenticated).

**Generating a client**: `yarn docs:generate` (from `server/`) writes the
current OpenAPI document to `server/openapi.json`, for the SPAs to generate
a typed client from (`yarn api:types` at the repo root runs both steps —
see the root README's "Regenerating API types"). This runs `nest build`
first and executes the **compiled** script (`node dist/scripts/generate-openapi.js`),
not `ts-node` — `@nestjs/swagger`'s CLI plugin (`nest-cli.json`'s
`compilerOptions.plugins`), which auto-infers `@ApiProperty()` for DTO/
entity fields from their TypeScript types, only runs through Nest's own
build compiler. Running the script via `ts-node` instead produces a
document with every DTO schema empty — Nest's compiler is what makes the
annotations effectively free instead of a decorator on every one of ~50
DTO classes.

**No sensitive field ever appears in a schema**: `User.password_hash` is
marked `@ApiHideProperty()` directly on the entity, so it's excluded from
every schema that references `User` — including ones no current endpoint
actually returns with that relation populated (Guardian.user, Student.user,
Payment.received_by) — not just the ones a controller happens to sanitize
today. Verified by generating the real document (`yarn docs:generate`) and
confirming zero `password_hash` occurrences; this can't be verified by an
ordinary Vitest test, since the CLI plugin (and therefore the schema
shape) doesn't run under Vitest's SWC-based transform at all.

## Adding a new module

Follow the shape of an existing one (`enrollments` is a good small
example): `*.module.ts`, `*.controller.ts` with `@ApiTenantAuth()` +
`@Roles(...)`, `*.service.ts`, `entities/*.entity.ts` with a relations
docstring (see [01-domain-model.md](01-domain-model.md) for the convention),
`dto/*.dto.ts` for request/response shapes. Every new controller/service
needs corresponding tests — see `server/CLAUDE.md` for the testing
standards enforced in this package.
