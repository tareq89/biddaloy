export enum Permission {
  // User Management
  USER_CREATE = 'USER_CREATE',
  USER_READ = 'USER_READ',
  USER_UPDATE = 'USER_UPDATE',
  // [10.4] G17 — no route deletes a user account; account deletion isn't a
  // staff-facing feature yet. Left SUPER_ADMIN-only (via
  // `ROLE_PERMISSIONS[SUPER_ADMIN] = Object.values(Permission)`) rather than
  // granted to ADMIN.
  USER_DELETE = 'USER_DELETE',
  // Removing a member's access to one school (deletes the user_tenants row,
  // not the account) — distinct from USER_DELETE, which no staff role holds.
  MEMBER_REMOVE = 'MEMBER_REMOVE',

  // Student Management
  STUDENT_CREATE = 'STUDENT_CREATE',
  // "May read the student records visible to you" — an *object-scoped*
  // read, not "may read the roster". [5.1] settled this deliberately
  // rather than splitting it into STUDENT_READ/STUDENT_LIST.
  //
  // Which records are visible is the server's decision, in two layers:
  //   - route `@Roles` — `GET /students` (the roster) admits staff only;
  //   - object-level linkage — `GET /students/mine` and `GET /students/:id`
  //     give a PARENT/STUDENT only the students they are linked to, via
  //     `FamilyAccessService` (server/src/modules/students/).
  //
  // So PARENT and STUDENT holding STUDENT_READ is correct and not a
  // client/server disagreement: they hold the read, the server decides the
  // scope. Compare PAYMENT_READ below, which is scoped the same way.
  STUDENT_READ = 'STUDENT_READ',
  STUDENT_UPDATE = 'STUDENT_UPDATE',
  STUDENT_DELETE = 'STUDENT_DELETE',
  STUDENT_BULK_UPLOAD = 'STUDENT_BULK_UPLOAD',

  // Guardian Management
  GUARDIAN_CREATE = 'GUARDIAN_CREATE',
  GUARDIAN_READ = 'GUARDIAN_READ',
  GUARDIAN_UPDATE = 'GUARDIAN_UPDATE',
  // [10.4] G15 — mirrors STUDENT_DELETE. ADMIN only.
  GUARDIAN_DELETE = 'GUARDIAN_DELETE',

  // Fee Management
  FEE_STRUCTURE_CREATE = 'FEE_STRUCTURE_CREATE',
  FEE_STRUCTURE_READ = 'FEE_STRUCTURE_READ',
  FEE_STRUCTURE_UPDATE = 'FEE_STRUCTURE_UPDATE',
  FEE_STRUCTURE_DELETE = 'FEE_STRUCTURE_DELETE',
  FEE_GENERATE = 'FEE_GENERATE',
  FEE_READ = 'FEE_READ',
  FEE_COLLECT = 'FEE_COLLECT',
  // [16.2.1] Approve a pending fee action (manual generation, edit-paid,
  // discount override, ...) gated by the tenant's `settings.fees.approval_mode`.
  // ADMIN only by default — see ROLE_PERMISSIONS comment below.
  FEE_APPROVE = 'FEE_APPROVE',

  // Invoice
  INVOICE_CREATE = 'INVOICE_CREATE',
  INVOICE_READ = 'INVOICE_READ',
  INVOICE_PRINT = 'INVOICE_PRINT',
  INVOICE_DELETE = 'INVOICE_DELETE',

  // Payment
  PAYMENT_RECORD = 'PAYMENT_RECORD',
  // The tenant-wide payment ledger — `GET /payments` (ADMIN, ACCOUNTANT
  // only) and the receipts surface the UI gates on it.
  //
  // Deliberately *not* required for per-student payment history:
  // `GET /payments/student/:studentId` admits TEACHER and EXECUTIVE, who
  // hold no PAYMENT_READ, and since [5.1] a linked PARENT/STUDENT too.
  // Per-student history rides on the caller's relationship to that student,
  // not on the ledger permission.
  PAYMENT_READ = 'PAYMENT_READ',
  PAYMENT_REFUND = 'PAYMENT_REFUND',
  // [16.2.1] Reverse a recorded payment (16.x money flow) — ADMIN only by
  // default, same reasoning as FEE_APPROVE: it undoes money already moved.
  PAYMENT_REVERSE = 'PAYMENT_REVERSE',

  // Communication
  COMMUNICATION_SEND = 'COMMUNICATION_SEND',
  COMMUNICATION_BULK_SEND = 'COMMUNICATION_BULK_SEND',
  COMMUNICATION_LOG_READ = 'COMMUNICATION_LOG_READ',
  // [15.6.7] `GET /communications/sms-credits` — a tenant's own SMS credit
  // balance + ledger. Deliberately its own permission, not folded into
  // COMMUNICATION_LOG_READ: the ledger never carries recipient/message
  // data, so it's a narrower disclosure than the communication log is.
  COMMUNICATION_CREDIT_READ = 'COMMUNICATION_CREDIT_READ',

  // Reports
  REPORTS_VIEW = 'REPORTS_VIEW',
  REPORTS_EXPORT = 'REPORTS_EXPORT',
  // [16.2.1] The fees/payments collections report (16.x) — distinct from the
  // general REPORTS_VIEW so a role can see collections without the whole
  // reports surface, and vice versa.
  REPORT_COLLECTIONS_READ = 'REPORT_COLLECTIONS_READ',

  // Dashboard
  DASHBOARD_VIEW = 'DASHBOARD_VIEW',
  DASHBOARD_ADMIN = 'DASHBOARD_ADMIN',

  // Academic Structure
  ACADEMIC_YEAR_MANAGE = 'ACADEMIC_YEAR_MANAGE',
  CLASS_MANAGE = 'CLASS_MANAGE',
  // [10.4] G4 — reference-data read (years/classes/sections/subjects/
  // calendar) every staff screen needs: student form, attendance register,
  // fee wizards, dues filter. ACADEMIC_YEAR_MANAGE/CLASS_MANAGE stay the
  // write gates and the nav gates; this is read-only, granted to all staff.
  ACADEMIC_STRUCTURE_READ = 'ACADEMIC_STRUCTURE_READ',

  // Audit
  AUDIT_LOG_READ = 'AUDIT_LOG_READ',
  // [10.4] G6 — the per-entity Activity tab on detail pages (object-scoped).
  // AUDIT_LOG_READ stays the tenant-wide ledger and the Audit nav gate
  // (ADMIN only, [8.11.10]). Same split as PAYMENT_READ vs per-student
  // payment history.
  AUDIT_ENTITY_HISTORY_READ = 'AUDIT_ENTITY_HISTORY_READ',

  // Settings
  SETTINGS_MANAGE = 'SETTINGS_MANAGE',
  // [16.2.1] Manage a recurring fee-generation `RecurringSchedule` (16.x).
  SCHEDULE_MANAGE = 'SCHEDULE_MANAGE',
  // [16.2.1] Manage a `DiscountRule` (16.x) — who qualifies for what
  // discount, applied automatically at generation time.
  DISCOUNT_RULE_MANAGE = 'DISCOUNT_RULE_MANAGE',

  // Attendance
  ATTENDANCE_READ = 'ATTENDANCE_READ',
  ATTENDANCE_MARK = 'ATTENDANCE_MARK',
  // Edit a mark outside the tenant's correction window, or on a
  // non-working day. Object scope (which sections) is still enforced
  // server-side.
  ATTENDANCE_CORRECT = 'ATTENDANCE_CORRECT',
  ATTENDANCE_DEVICE_MANAGE = 'ATTENDANCE_DEVICE_MANAGE',

  // Backup
  // [14.2.1] Export and restore of the school's data workbook. ADMIN and
  // SUPER_ADMIN only — the surface is destructive (a restore overwrites
  // tenant data) and has no partial, role-scoped form. No route consumes
  // this yet; the backup endpoints land later in Epic 14.0 lane 14.2,
  // which is why it is listed in permission-matrix.e2e-spec.ts's
  // UI_ONLY_PERMISSIONS for now.
  BACKUP_MANAGE = 'BACKUP_MANAGE',

  // Calendar
  // [17.1.1] D19 — school calendar (holidays, exams, events, terms). Read
  // is granted to every tenant role; write (create/edit/delete holidays,
  // events, terms, import public holidays) is ADMIN only.
  CALENDAR_READ = 'CALENDAR_READ',
  CALENDAR_MANAGE = 'CALENDAR_MANAGE',

  // Grading
  // [20.1.1] Manage grading scales/bands (percent-to-grade mapping).
  // ADMIN only — no read permission: teachers/executives see scales
  // implicitly through results, not as a standalone list.
  GRADING_SCALE_MANAGE = 'GRADING_SCALE_MANAGE',

  // Exams (19.x)
  // [19.1.1] Create/edit/delete Exam, ExamComponent, ExamSchedule.
  EXAM_MANAGE = 'EXAM_MANAGE',
  // [19.1.1] Write access to the marks-entry grid. Runtime-scoped further
  // for TEACHER by `TeacherClassSection` (19.4.1) — a teacher only sees
  // marks entry for sections/subjects they are assigned to; that narrowing
  // happens in the marks-entry service, not here.
  MARK_ENTER = 'MARK_ENTER',
  // [19.1.1] Read the marks-entry grid (without editing it).
  MARK_VIEW = 'MARK_VIEW',
  // [19.1.1] Run NCTB result computation for an exam (DRAFT → PROCESSED).
  RESULT_PROCESS = 'RESULT_PROCESS',
  // [19.1.1] Publish a processed result (PROCESSED → PUBLISHED), which
  // makes it guardian-visible and can trigger result SMS (19.5.1).
  RESULT_PUBLISH = 'RESULT_PUBLISH',
  // [19.1.1] Read a published (or, for staff, processed) result.
  RESULT_READ = 'RESULT_READ',
  // [25.1.1] Create/edit/publish a SeatPlan and its seat allocations.
  SEAT_PLAN_MANAGE = 'SEAT_PLAN_MANAGE',
  // [26.1.1] Create/edit/run a PromotionRun (D22). ADMIN only — no separate
  // analysis permission; analysis reuses MARK_VIEW.
  PROMOTION_MANAGE = 'PROMOTION_MANAGE',
  // [26.1.1] Commit a run that overrides the suggested outcome for at least
  // one student (D11, D22) — gated behind ApprovalScope.PROMOTION_OVERRIDE.
  PROMOTION_OVERRIDE = 'PROMOTION_OVERRIDE',
  // Routine (class timetable)
  // [21.1.1] Read is granted to every tenant role that has a stake in a
  // published routine (admin, executive, teacher, guardian, student);
  // write (build/edit/publish a routine, its slots, its change requests)
  // is ADMIN only.
  ROUTINE_READ = 'ROUTINE_READ',
  ROUTINE_MANAGE = 'ROUTINE_MANAGE',

  // Homework/Syllabus (22.x)
  // [22.1.1] D26 — read a Homework/HomeworkAssignment/HomeworkSubmission.
  HOMEWORK_READ = 'HOMEWORK_READ',
  // [22.1.1] Create/reassign a HomeworkAssignment.
  HOMEWORK_ASSIGN = 'HOMEWORK_ASSIGN',
  // [22.1.1] Grade a HomeworkSubmission.
  HOMEWORK_GRADE = 'HOMEWORK_GRADE',
  // [22.1.1] CSV bulk-create of HomeworkAssignment rows (D21).
  HOMEWORK_IMPORT = 'HOMEWORK_IMPORT',
  // [22.1.1] Read a SyllabusTopic.
  SYLLABUS_READ = 'SYLLABUS_READ',
  // [22.1.1] Create/edit/mark a SyllabusTopic's status.
  SYLLABUS_MANAGE = 'SYLLABUS_MANAGE',
}

import { UserRole } from './index';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission),

  [UserRole.ADMIN]: [
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.MEMBER_REMOVE,
    Permission.STUDENT_CREATE,
    Permission.STUDENT_READ,
    Permission.STUDENT_UPDATE,
    Permission.STUDENT_DELETE,
    Permission.STUDENT_BULK_UPLOAD,
    Permission.GUARDIAN_CREATE,
    Permission.GUARDIAN_READ,
    Permission.GUARDIAN_UPDATE,
    // [10.4] G15 — mirrors STUDENT_DELETE.
    Permission.GUARDIAN_DELETE,
    Permission.FEE_STRUCTURE_CREATE,
    Permission.FEE_STRUCTURE_READ,
    Permission.FEE_STRUCTURE_UPDATE,
    Permission.FEE_STRUCTURE_DELETE,
    Permission.FEE_GENERATE,
    Permission.FEE_READ,
    Permission.FEE_COLLECT,
    // [16.2.1] Approving fee actions is ADMIN-only by default — the
    // tenant's `settings.fees.approval_mode` gates *how* (OTP vs
    // OTP-or-password), not *who*.
    Permission.FEE_APPROVE,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_PRINT,
    // [10.4] G17 — reserved for the refunds/void endpoint (#291); no route
    // consumes it yet.
    Permission.INVOICE_DELETE,
    Permission.PAYMENT_RECORD,
    Permission.PAYMENT_READ,
    // [10.4] G17 — reserved for the refunds endpoint (#291); no route
    // consumes it yet.
    Permission.PAYMENT_REFUND,
    // [16.2.1] Reversing a payment undoes money already moved — ADMIN only.
    Permission.PAYMENT_REVERSE,
    Permission.COMMUNICATION_SEND,
    Permission.COMMUNICATION_BULK_SEND,
    Permission.COMMUNICATION_LOG_READ,
    // [15.6.7] SMS credit balance/ledger.
    Permission.COMMUNICATION_CREDIT_READ,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    // [16.2.1] Fees/payments collections report.
    Permission.REPORT_COLLECTIONS_READ,
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_ADMIN,
    Permission.ACADEMIC_YEAR_MANAGE,
    Permission.CLASS_MANAGE,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    Permission.AUDIT_LOG_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.SETTINGS_MANAGE,
    // [16.2.1] Recurring fee-generation schedules and discount rules.
    Permission.SCHEDULE_MANAGE,
    Permission.DISCOUNT_RULE_MANAGE,
    Permission.ATTENDANCE_READ,
    Permission.ATTENDANCE_MARK,
    Permission.ATTENDANCE_CORRECT,
    Permission.ATTENDANCE_DEVICE_MANAGE,
    // [14.2.1] Backup/restore; see enum comment.
    Permission.BACKUP_MANAGE,
    // [17.1.1] School calendar — ADMIN manages, everyone else reads.
    Permission.CALENDAR_READ,
    Permission.CALENDAR_MANAGE,
    // [20.1.1] Grading scales — ADMIN only.
    Permission.GRADING_SCALE_MANAGE,
    // [19.1.1] Exams/marks/results — ADMIN holds all six.
    Permission.EXAM_MANAGE,
    Permission.MARK_ENTER,
    Permission.MARK_VIEW,
    Permission.RESULT_PROCESS,
    Permission.RESULT_PUBLISH,
    Permission.RESULT_READ,
    // [25.1.1] Seat plans — ADMIN only.
    Permission.SEAT_PLAN_MANAGE,
    // [26.1.1] Promotion runs — ADMIN only (D22).
    Permission.PROMOTION_MANAGE,
    Permission.PROMOTION_OVERRIDE,
    // [21.1.1] Class routine — ADMIN builds/publishes, everyone else reads.
    Permission.ROUTINE_READ,
    Permission.ROUTINE_MANAGE,
    // [22.1.1] D26 — ADMIN holds all six homework/syllabus permissions.
    Permission.HOMEWORK_READ,
    Permission.HOMEWORK_ASSIGN,
    Permission.HOMEWORK_GRADE,
    Permission.HOMEWORK_IMPORT,
    Permission.SYLLABUS_READ,
    Permission.SYLLABUS_MANAGE,
  ],

  [UserRole.ACCOUNTANT]: [
    Permission.STUDENT_READ,
    // Matches `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` on
    // `POST /students/bulk-upload`. Without it the endpoint is callable but
    // the "Import students" button is hidden, which reads as a broken
    // feature rather than a deliberate restriction.
    Permission.STUDENT_BULK_UPLOAD,
    // [10.4] G3 — resolves the "can import 500 but cannot add one by hand"
    // contradiction the map used to flag. ACCOUNTANT is the front-office
    // clerk who does intake; the server has admitted this role on these
    // routes since day one. Visible effect: ACCOUNTANT gains
    // `/students/new`, `/students/:id/edit`, the enrollment tab's edit
    // controls, and guardian edit.
    Permission.STUDENT_CREATE,
    Permission.STUDENT_UPDATE,
    Permission.GUARDIAN_CREATE,
    Permission.GUARDIAN_READ,
    Permission.GUARDIAN_UPDATE,
    Permission.FEE_STRUCTURE_CREATE,
    Permission.FEE_STRUCTURE_READ,
    Permission.FEE_STRUCTURE_UPDATE,
    Permission.FEE_GENERATE,
    Permission.FEE_READ,
    Permission.FEE_COLLECT,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_PRINT,
    Permission.PAYMENT_RECORD,
    Permission.PAYMENT_READ,
    Permission.COMMUNICATION_SEND,
    Permission.COMMUNICATION_BULK_SEND,
    // [10.4] G5 — the student-detail Communications tab (visible via
    // STUDENT_READ) calls these; no nav item gates on this permission.
    Permission.COMMUNICATION_LOG_READ,
    // [15.6.7] SMS credit balance/ledger.
    Permission.COMMUNICATION_CREDIT_READ,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    // [16.2.1] Fees/payments collections report.
    Permission.REPORT_COLLECTIONS_READ,
    Permission.DASHBOARD_VIEW,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    // [16.2.1] Deliberately no FEE_APPROVE, no PAYMENT_REVERSE — those stay
    // ADMIN-only regardless of the tenant's approval_mode.
    Permission.SCHEDULE_MANAGE,
    Permission.DISCOUNT_RULE_MANAGE,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
  ],

  [UserRole.TEACHER]: [
    Permission.STUDENT_READ,
    Permission.GUARDIAN_READ,
    // Deliberately no FEE_STRUCTURE_READ, even though the controller's
    // `@Roles` lets a TEACHER call the fee-structure GETs: granting it here
    // would surface the whole Finance nav group to teachers, which is a
    // product decision well outside [8.11.5]. Flagged rather than fixed.
    Permission.FEE_READ,
    Permission.COMMUNICATION_SEND,
    // [10.4] G5 — per-student Communications tab; see ACCOUNTANT comment.
    Permission.COMMUNICATION_LOG_READ,
    Permission.DASHBOARD_VIEW,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.ATTENDANCE_READ,
    Permission.ATTENDANCE_MARK,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Marks entry (scoped further by TeacherClassSection at
    // runtime, see enum comment) and own-section result reads.
    Permission.MARK_ENTER,
    Permission.MARK_VIEW,
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
    // [22.1.1] D26 — TEACHER is the relevant teacher role, holds all six.
    Permission.HOMEWORK_READ,
    Permission.HOMEWORK_ASSIGN,
    Permission.HOMEWORK_GRADE,
    Permission.HOMEWORK_IMPORT,
    Permission.SYLLABUS_READ,
    Permission.SYLLABUS_MANAGE,
  ],

  // [5.1] added no permissions to either family role. The widened server
  // routes (`/students/mine`, `/fees/dues`, `/fee-structures`,
  // `/payments/student/:id`, `/payments/invoices/student/:id`, `/invoices`,
  // `/invoices/:id`, `/invoices/:id/print`) are all covered by the three
  // reads below — object-scoped, per the STUDENT_READ note above.
  // Deliberately no PAYMENT_READ: that is the tenant-wide ledger.
  //
  // ATTENDANCE_READ is scoped the same way: server decides which student's
  // register a PARENT/STUDENT can see, via FamilyAccessService — same
  // reasoning as STUDENT_READ above.
  [UserRole.PARENT]: [
    Permission.STUDENT_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Guardian-visible published results (D1's spine scope).
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
    // [22.1.1] D26 — PARENT/STUDENT get only the two _READ permissions.
    Permission.HOMEWORK_READ,
    Permission.SYLLABUS_READ,
  ],

  [UserRole.STUDENT]: [
    Permission.STUDENT_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Own published results (D1's spine scope).
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
    // [22.1.1] D26 — PARENT/STUDENT get only the two _READ permissions.
    Permission.HOMEWORK_READ,
    Permission.SYLLABUS_READ,
  ],

  [UserRole.EXECUTIVE]: [
    Permission.STUDENT_READ,
    // Same reasoning as ACCOUNTANT above — the server route already admits
    // EXECUTIVE, so the UI gate matches it rather than being stricter.
    //
    // [10.4] G12 — still deliberately no GUARDIAN_READ: this role has no
    // surface for viewing guardians (`/guardians` is hidden, guardians are
    // excluded from global search). The corresponding routes are TIGHTENed
    // (EXECUTIVE removed from `@Roles`) rather than granting an unused read.
    Permission.STUDENT_BULK_UPLOAD,
    // Deliberately no FEE_STRUCTURE_* — same call as TEACHER above. The
    // controller's `@Roles` does let an EXECUTIVE hit these endpoints, but
    // `/fees` and `/fee-structures` are both gated on FEE_STRUCTURE_READ,
    // so granting it here surfaces the whole Finance group to a role whose
    // navigation is deliberately scoped to Students
    // (`e2e/journeys/permissions.spec.ts`'s CASES pin that). Widening it is
    // a product decision, not a mapping fix.
    Permission.FEE_READ,
    Permission.REPORTS_VIEW,
    // [16.2.1] Read-only subset — the collections report, not FEE_APPROVE/
    // FEE_GENERATE/PAYMENT_REVERSE/SCHEDULE_MANAGE/DISCOUNT_RULE_MANAGE.
    Permission.REPORT_COLLECTIONS_READ,
    Permission.DASHBOARD_VIEW,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G5 — per-student Communications tab; see ACCOUNTANT comment.
    Permission.COMMUNICATION_LOG_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Executives see marks/results read-only.
    Permission.MARK_VIEW,
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
  ],
};

/** True when `role` holds `permission` in ROLE_PERMISSIONS. Unknown or null roles hold nothing.
 * The own-property check keeps a role string like `'constructor'` or `'toString'` from
 * resolving to an inherited `Object.prototype` value instead of `undefined`. */
export function roleHasPermission(
  role: string | null | undefined,
  permission: Permission,
): boolean {
  if (!role || !Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return false;
  return ROLE_PERMISSIONS[role as UserRole].includes(permission);
}
