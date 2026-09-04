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
    School ||--o{ SchoolHoliday : scopes

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
    AcademicYear ||--o{ SchoolHoliday : "calendar for"
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
  academic-year + school.
- **`ClassSection`** — a division within a class (e.g. "Section A").
- **`Teacher`** — a staff profile layered on top of a `User`. Can hold
  multiple designations and be assigned to multiple sections via
  **`TeacherClassSection`**.

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
- **`SchoolHoliday`** (`modules/academics`) — a calendar entry (holiday, exam day, event) attendance reads to compute working-day math; an academics concern, not an attendance one.

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
