# Domain Model

All entities live under `server/src/modules/*/entities/`. Every entity file
has a detailed docstring explaining its relations and any non-obvious
rationale — treat that docstring as the primary source of truth; this doc is
a map to help you find the right one.

## Entity-relationship diagram

```mermaid
erDiagram
    School ||--o{ UserTenant : "has members"
    User ||--o{ UserTenant : "has memberships"
    School ||--o{ AcademicYear : scopes
    School ||--o{ Class : scopes
    School ||--o{ Teacher : scopes
    School ||--o{ Student : scopes
    School ||--o{ Guardian : scopes
    School ||--o{ FeeStructure : scopes
    School ||--o{ Payment : scopes
    School ||--o{ CommunicationLog : scopes
    School ||--o{ ReminderBatch : scopes
    School ||--o{ AttendanceSession : scopes
    School ||--o{ AttendanceDevice : scopes
    School ||--o{ CalendarEvent : scopes
    School ||--o{ AcademicTerm : scopes
    School ||--o{ CalendarFeedToken : scopes

    AcademicYear ||--o{ Class : contains
    AcademicYear ||--o{ FeeStructure : "fees for"
    AcademicYear ||--o{ StudentFee : "generated within"
    Class ||--o{ ClassSection : "divided into"
    ClassSection }o--o{ Teacher : "assigned (teacher_class_sections)"

    Student }o--|| ClassSection : "enrolled in"
    Student ||--o{ Enrollment : "history"
    Student }o--o{ Guardian : "linked (student_guardians)"
    User ||--o| Teacher : "profile"
    User ||--o| Guardian : "profile"
    User ||--o| Student : "profile"

    FeeStructure ||--o{ FeeStructureStudent : "selected students"
    FeeStructure ||--o{ StudentFee : generates
    Student ||--o{ StudentFee : owes
    StudentFee ||--o{ PaymentAllocation : "paid via"
    Payment ||--o{ PaymentAllocation : "splits into"
    Student ||--o{ Payment : pays
    User ||--o{ Payment : "recorded by"
    Payment ||--o| Invoice : generates
    StudentFee ||--o| Invoice : "referenced by"
    User ||--o{ Invoice : "issued by"

    Student ||--o{ CommunicationLog : about
    Guardian ||--o{ CommunicationLog : recipient
    ReminderBatch ||--o{ CommunicationLog : produces

    User ||--o{ AuditLog : "performed by"
    User ||--o{ RefreshToken : owns
    ClassSection ||--o{ AttendanceSession : "registers for"
    AttendanceSession ||--o{ AttendanceRecord : "marks students in"
    Student ||--o{ AttendanceRecord : "marked in"
    AttendanceDevice ||--o{ AttendanceRecord : "produced"
    AttendanceDevice ||--o{ AttendanceDeviceEvent : "sent"
    AcademicYear ||--o{ CalendarEvent : "calendar for"
    AcademicYear ||--o{ AcademicTerm : "split into"
    CalendarEvent ||--o{ CalendarEventClass : "scoped to (empty = all classes)"
    Class ||--o{ CalendarEventClass : "scoped by"
    User ||--o{ CalendarFeedToken : "subscribes via"

    AcademicYear ||--o{ GradingScale : "graded under"
    Class ||--o{ GradingScale : "overridden by"
    GradingScale ||--o{ GradingBand : "made of"

    AcademicYear ||--o{ Exam : "held in"
    Class ||--o{ Exam : "sits"
    Exam ||--o{ ExamComponent : "made of"
    Subject ||--o{ ExamComponent : measures
    Exam ||--o{ MarkGrid : "entry grid per"
    ClassSection ||--o{ MarkGrid : "graded by"
    Subject ||--o{ MarkGrid : "graded in"
    Exam ||--o{ Mark : "marks for"
    Student ||--o{ Mark : "marked in"
    ExamComponent ||--o{ Mark : "values for"
    Exam ||--o{ Result : "computed result per"
    Student ||--o{ Result : "has a"
    GradingScale ||--o{ Result : "pinned against"
    Result ||--o{ ResultSubject : "breaks down into"
    ClassSection ||--o{ Result : "sat in (section_id/section_position, D17)"
    Subject ||--o{ ResultSubject : "line for"
    Student ||--o{ StudentSubjectChoice : "picks a"
    ClassSubject ||--o{ StudentSubjectChoice : "chosen offering"

    Class ||--o{ PromotionRun : "source class of"
    School ||--o{ PromotionRun : scopes
    PromotionRun ||--o{ PromotionEntry : "one row per student"
    Student ||--o{ PromotionEntry : "decided for"
    Enrollment ||--o{ PromotionEntry : "carried forward from (source_enrollment_id)"
    Enrollment ||--o| PromotionEntry : "creates on commit (target_enrollment_id)"
```

_(This shows the shape of the graph, not every column — see each entity file
for full field lists.)_

## Entities by domain area

### Tenancy & identity (`modules/schools`, `modules/users`, `modules/auth`)

- **`School`** — a tenant. Every school-scoped table has a `tenant_id` (or
  goes through a relation that resolves to one). See
  [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md).
- **`User`** — one account per person, **not** scoped to a single school.
  Holds login credentials (`password_hash`, nullable for guardians/students
  who never log in) and profile basics.
- **`UserTenant`** — junction table: `(user, school, role)`. This is where
  RBAC roles actually live, _not_ on `User` — a person can be `TEACHER` at
  School A and `PARENT` at School B simultaneously.

### Academics (`modules/academics`)

- **`AcademicYear`** — a school's calendar period (e.g. "2026-2027"),
  school-scoped. Only one can be `is_current` per school. Everything
  fee-related is ultimately scoped to one of these.
- **`Class`** — a grade/standard (e.g. "Class 10"), unique per
  academic-year + school + `shift` + `version`. `shift` (e.g. "Morning" vs
  "Day") and `version` (e.g. "Bangla" vs "English") are free-text values a
  school configures for itself in Settings → Organisation
  (`TenantSettings.organisation.{shifts,versions}`) — a school that doesn't
  use either dimension just leaves every class's `shift`/`version` `NULL`.
  `NULL` is treated as one specific, real value here, not a wildcard: two
  `Class 6` rows with `shift: NULL` **collide**, exactly like two `Class 6`
  rows both with `shift: 'Morning'` would — so a school that never sets a
  shift still only ever gets one `Class 6` per year, not an unlimited
  number of them. `Class 6` with `shift: NULL` and a separate `Class 6`
  with `shift: 'Morning'` _do_ stay distinct. Postgres's own default
  (`NULLS DISTINCT`) would let any number of `NULL`-shift `Class 6` rows
  through silently — the unique index is declared `NULLS NOT DISTINCT`
  specifically to close that gap (`1789800010700-AddOrganisationDimensions.ts`).
  **Branches are a separate concern**: a school with multiple physical
  branches models each branch as its own tenant (`School` row) with its own
  EIIN, not as a shift/version value (Epic 33 decision D1).
- **`ClassSection`** — a division within a class (e.g. "Section A"), with an
  optional `group` (e.g. "Science" vs "Commerce") drawn from the same
  tenant vocabulary (`organisation.groups`). Unlike shift/version, `group`
  is **not** part of what makes a section unique — two sections named "A"
  in the same class always collide regardless of group.
- **`Teacher`** — a staff profile layered on top of a `User`. Can hold
  multiple designations and be assigned to multiple sections via
  **`TeacherClassSection`**.

### Grading (`modules/grading`)

- **`GradingScale`** — a set of percent-to-grade bands for one
  `AcademicYear`. `class_id` null means "this year's default scale"; a
  non-null `class_id` overrides the default for that one class (e.g. a
  vocational track grading itself pass/fail while the rest of the year
  uses the default GPA scale). Only one default scale may exist per
  (tenant, academic year).

  `revision` bumps whenever a scale's bands change after results have
  already been computed against it, so a past result stays readable
  against the band set that actually produced it (a later epic wires
  results to read it back). A workbook restore always writes
  the backed-up `revision` value, never the entity's own `default: 1`, so
  restoring a scale that had already been revised does not quietly roll
  it back to looking untouched.

- **`GradingBand`** — one percent range within a scale, e.g. "80-100% →
  A+, GPA 5.0". `gpa` is nullable: a scale that only ever grades with
  letters (no numeric GPA) leaves it `null` on every band, not `0.00`.

```
GradingScale (2026-2027, class: null)         "the year's default"
├── GradingBand  80-100  A+  gpa 5.00
├── GradingBand  70-79   A   gpa 4.00
└── GradingBand   0-69   F   gpa null   (D4: fail band, not a zero GPA)

GradingScale (2026-2027, class: "Class 9-Vocational")   "an override"
├── GradingBand  50-100  PASS  gpa null
└── GradingBand   0-49   FAIL  gpa null   is_fail: true
```

- **`ClassSubject.is_graded_only`** — marks a subject (e.g. "Physical
  Education") that only ever gets a pass/fail-style grade and is excluded
  from GPA computation, even though it still sits under the same
  `GradingScale` as every other subject in the class.

Result composition — turning a set of subject marks into one grade per
subject and one GPA for the term — is **out of scope for this epic
(20.x)**. This doc covers only the scale/band data model and its
backup/restore path; the composition rules land in a later epic.

### Exams, marks & results (`modules/exams`) — Epic 19.0

```
Exam (First Term Exam, Class 6, 2026-2027)   status: DRAFT -> PROCESSED -> PUBLISHED
├── ExamComponent  Math / Written    full_marks 100   source: MANUAL
├── ExamComponent  Math / Attendance full_marks 10    source: DERIVED  (D11, read-only)
├── ExamComponent  English / Written full_marks 100   source: MANUAL
│
├── MarkGrid  Section A × Math      state: SUBMITTED
├── MarkGrid  Section B × Math      state: DRAFT        ← progress screen shows this
│
├── Mark  student=Karim  component=Math/Written    value 78.50  status PRESENT
├── Mark  student=Rahim  component=Math/Written    value null   status ABSENT   (D10)
│
└── Result  student=Karim   total 167.00  grade A  ── pinned: grading_scale_id, grading_scale_revision, rule_version
    └── ResultSubject  Math      obtained 89.00  grade A
    └── ResultSubject  English   obtained 78.00  grade A
```

- **`Exam`** — one sitting (e.g. "First Term Exam") for one `Class` in one
  `AcademicYear`. `kind` (TERM/MONTHLY/MODEL/OTHER) is a label only, no
  behaviour keys off it. `status` is the D12 lifecycle: `DRAFT` (marks being
  entered) → `PROCESSED` (results computed) → `PUBLISHED` (visible to
  guardians in the portal).
- **`ExamComponent`** — one markable part of one exam-subject, e.g. "Written"
  and "MCQ" for Math. `full_marks`/`pass_marks` are per component; a
  subject's total is the sum of its components. `source` distinguishes
  `MANUAL` (typed on the marks grid) from `DERIVED` (computed server-side —
  currently only `ATTENDANCE`, D11 — never accepts direct grid entry).
- **`MarkGrid`** — one section-subject's entry state for one exam (D12):
  `DRAFT` is editable, `SUBMITTED` locks it. One row per (exam, section,
  subject).
- **`Mark`** — one student's value for one component. **D10**: `value` is
  `NULL` whenever `status` isn't `PRESENT`, enforced by a database CHECK
  constraint — an `ABSENT` mark can never be misread as a zero, on the grid
  or after a workbook restore.
- **`Result`** — one student's computed outcome for an exam: total marks,
  GPA, grade, class position, pass/fail. **D19**: pins
  `grading_scale_id` + `grading_scale_revision` + `rule_version` at the
  moment it's computed — the same "snapshot, don't re-derive" pattern
  `Invoice.snapshot` uses for money. A later edit to the grading scale
  (Epic 20.0 D6 makes scales editable) bumps the scale's own `revision` and
  triggers a recompute of dependent results; comparing an old result's
  `grading_scale_revision` against the scale's current `revision` is how a
  caller notices a printed card has gone stale.
- **`ResultSubject`** — one subject's line within a `Result` — what a report
  card actually prints. `is_fourth_subject` records whether this line
  counted as the student's chosen fourth/optional subject for this result.
- **`StudentSubjectChoice`** — a student's fourth/optional subject pick
  (D14), per student rather than per class, since two students in the same
  class can pick different fourth subjects. `academic_year_id` is
  denormalised from the chosen `ClassSubject` so "one `is_fourth` choice per
  student per year" can be enforced by a database index.

**Out of scope, on purpose:** composing several exams' results into one
term/annual outcome — averaging or weighting marks across TERM + MONTHLY +
MODEL exams — is deliberately **not** part of this epic (decision D3). Every
entity above is scoped to a single `Exam`; nothing here reads across exams.
A future epic owns that composition, so a reader who notices its absence
should not read it as a gap left behind by accident.

**D17 — the exam cohort comes from `Enrollment`, not `Student.class_section`.**
`ResultsService.computeAll`, `MarkGridService`'s roster, and the marks IDOR
guard all resolve "who sits this exam" by querying the student's **ACTIVE
`Enrollment`** row for the exam's `(academic_year, class)`, not the
student's live `class_section` pointer. This matters once a student has
moved sections mid-year, or a promotion run has advanced them into next
year's class: an exam processed for last year's class still finds exactly
the roster that actually sat it, because `Enrollment` is the historical
record and `Student.class_section` only ever reflects _today_.

`Result.section_id` / `Result.section_position` (added alongside D17) pin
which section a student actually sat the exam in and their merit rank
within that `(exam, section)` pair — computed once, at process time, so it
stays correct even if the student is later moved or promoted out of that
section.

### Promotions (`modules/promotions`) — Epic 26.6–26.8

```
PromotionRun (Class 6 -> Class 7, 2026-2027)   status: DRAFT -> COMMITTED
├── algorithm: BLOCK | SNAKE                    (how next-year sections are filled)
├── exam_ids: [First Term, Second Term]         (which published exams feed the mean GPA)
│
├── PromotionEntry  student=Karim
│   ├── suggested_outcome: PROMOTE   final_outcome: PROMOTE   is_override: false
│   └── target_section_id, new_roll_number   (set once placement runs)
└── PromotionEntry  student=Rahim
    ├── suggested_outcome: PROMOTE   final_outcome: RETAIN   is_override: true
    └── override_note: "Repeating — attendance"   (required by a DB CHECK when is_override)
```

- **`PromotionRun`** — one end-of-year promotion attempt for a source
  `Class`: which published exams feed the decision (a plain mean across
  them — see the composition caveat below), which placement algorithm
  (`BLOCK` fills sections in merit-rank blocks, `SNAKE` interleaves them for
  even ability spread) assigns next-year sections, and whether it's been
  committed. `DRAFT` runs are freely re-runnable and re-computable;
  `COMMITTED` is final. `target_class_id: null` means this run **graduates**
  the whole class out of the school rather than promoting it. Hard-deleted
  (no `deleted_at`) when discarded — a draft carries no history worth
  keeping.
- **`PromotionEntry`** — one student's decision within a run: merit stats
  (`mean_gpa`, `total_marks_sum`), the algorithm's `suggested_outcome`, and
  the possibly human-`override`n `final_outcome` actually applied on
  commit. `is_override: true` requires a non-blank `override_note`,
  enforced by a DB CHECK, not just app validation. `source_enrollment_id`
  points at the `Enrollment` row (D17) this entry was computed from;
  `target_enrollment_id` is filled in on commit once placement has created
  the student's next-year `Enrollment`.

**Composition caveat, stated plainly:** a promotion run's `mean_gpa` is a
**plain mean** of the selected exams' GPAs (D7) — not a weighted average
(e.g. "Second Term counts double"). Weighted cross-exam composition is the
same gap already called out above for report cards (D3): still absent, on
purpose, not forgotten. A future epic that adds per-exam weights to result
composition should extend the promotion mean the same way.

### Calendar (`modules/calendar`) — see [16-academic-calendar.md](16-academic-calendar.md) for the full model

- **`CalendarEvent`** — see under Attendance below; the one calendar table
  every other module reads.
- **`AcademicTerm`** — a term/semester/trimester within an `AcademicYear`;
  ordered by `seq`, never overlaps another term in the same year.
- **`CalendarEventClass`** — join table scoping a `CalendarEvent` to
  specific `Class`es; no rows means "every class."
- **`CalendarFeedToken`** — a revocable per-user token that turns into a
  subscribable ICS feed URL.
- **`PublicHolidaySet`** (platform-level, no `tenant_id`) — one country's
  fetched public holidays for one year, shared across every tenant in that
  country.

### Students & guardians (`modules/students`)

- **`Student`** — belongs to one `ClassSection` at a time; optionally has a
  `User` for self-service login. Has a unique `registration_number` and a
  `roll_number` unique within its section.
- **`Guardian`** — a parent, optionally with a `User` login. Many-to-many
  with `Student` (siblings share guardians; a student can have two
  guardians) via the `student_guardians` pivot.
- **`Enrollment`** — historical record of which class/section a student was
  in during a given academic year. The _current_ enrollment is the most
  recent `ACTIVE` row — `Student.class_section` is the fast-path pointer,
  `Enrollment` is the audit trail.

### Fees, payments, invoices (`modules/fees`, `modules/invoices`) — see [04-fees-payments-invoices.md](04-fees-payments-invoices.md) for the full lifecycle

- **`FeeStructure`** — the _template_: "this fee applies to Class 10 / all
  students (or a selected subset) / this academic year / this month, and
  recurs monthly or not."
- **`FeeStructureStudent`** — pivot recording exactly which students a
  `SELECTED`-applicability fee structure applies to.
- **`StudentFee`** — the _obligation_: one student's fee for one month,
  generated from a `FeeStructure` by the fee-generation engine. Carries
  `total_amount`, `paid_amount`, `discount_amount`, and a status that moves
  `PENDING → PARTIALLY_PAID → PAID` as payments are allocated against it.
- **`Payment`** — a transaction (cash/cheque today). Can cover several
  `StudentFee` periods at once.
- **`PaymentAllocation`** — how one `Payment` is split across one or more
  `StudentFee` rows (`DUE`, `CURRENT`, or `ADVANCE`).
- **`Invoice`** — a printable/shareable document generated from a payment,
  sequentially numbered (`INV-YYYY-XXXXX`), snapshotting line items so it
  stays accurate even if the fee structure changes later.

### Communications (`modules/communications`) — see [05-communications.md](05-communications.md)

- **`CommunicationLog`** — one row per message actually sent (SMS,
  WhatsApp, email, phone call, Messenger), to a student and/or guardian.
- **`ReminderBatch`** — tracks a bulk reminder campaign (progress, success
  rate, filters used); each message it produces gets its own
  `CommunicationLog` row.

### Attendance (`modules/attendance`)

- **`AttendanceSession`** — one register: a section, on one school day, for one period (or the whole day if `period_no` is null). Holds no marks itself.
- **`AttendanceRecord`** — one student's mark within one `AttendanceSession`. `date` is denormalised from the session for fast per-student range queries.
- **`AttendanceDevice`** — a biometric/face/RFID reader that can post attendance events for a tenant.
- **`AttendanceDeviceEvent`** — one raw scan a device sent, the forensic trail behind an `AttendanceRecord`.
- **`CalendarEvent`** (`modules/calendar`, [16-academic-calendar.md](16-academic-calendar.md)) — a holiday, exam, event, meeting, or deadline attendance reads to compute working-day math. Renamed from `SchoolHoliday` in [17.1.2] to reflect the wider set of `type`s the calendar module now owns; a `calendar` concern, not an `academics` one.

### Audit & auth internals (`modules/audit`, `modules/auth`)

- **`AuditLog`** — write-only, immutable log of every significant action
  (who, what, when, old/new values). See the root README's "Audit trail"
  section for the full write path.
- **`RefreshToken`** — one token in a rotation "family"; only a hash is
  stored. See [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md).

## Conventions worth knowing before you add a table

- **Soft deletes** (`@DeleteDateColumn`) are used on tenant-owned entities
  (`School`, `Student`, `Guardian`, …) — never hard-delete these.
- **UUID primary keys** everywhere (`@PrimaryGeneratedColumn('uuid')`).
- **`created_at`/`updated_at`** (`timestamptz`) on every entity.
- Every school-scoped entity carries its `tenant_id`/`School` relation
  **directly**, even when it could technically be derived through another
  relation (e.g. `CommunicationLog.school` isn't derived from
  `student`/`guardian`) — deriving tenant scoping through an optional
  relation would leave rows with no populated relation readable by any
  tenant. Always add a direct tenant reference on a new entity rather than
  relying on a join to prove ownership.
