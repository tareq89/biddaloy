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

  // Attendance
  ATTENDANCE_READ = 'ATTENDANCE_READ',
  ATTENDANCE_MARK = 'ATTENDANCE_MARK',
  // Edit a mark outside the tenant's correction window, or on a
  // non-working day. Object scope (which sections) is still enforced
  // server-side.
  ATTENDANCE_CORRECT = 'ATTENDANCE_CORRECT',
  ATTENDANCE_DEVICE_MANAGE = 'ATTENDANCE_DEVICE_MANAGE',
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
    Permission.COMMUNICATION_SEND,
    Permission.COMMUNICATION_BULK_SEND,
    Permission.COMMUNICATION_LOG_READ,
    // [15.6.7] SMS credit balance/ledger.
    Permission.COMMUNICATION_CREDIT_READ,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
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
    Permission.ATTENDANCE_READ,
    Permission.ATTENDANCE_MARK,
    Permission.ATTENDANCE_CORRECT,
    Permission.ATTENDANCE_DEVICE_MANAGE,
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
    Permission.DASHBOARD_VIEW,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.ATTENDANCE_READ,
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
  ],

  [UserRole.STUDENT]: [
    Permission.STUDENT_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.ATTENDANCE_READ,
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
    Permission.DASHBOARD_VIEW,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G5 — per-student Communications tab; see ACCOUNTANT comment.
    Permission.COMMUNICATION_LOG_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.ATTENDANCE_READ,
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
