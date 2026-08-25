export enum Permission {
  // User Management
  USER_CREATE = 'USER_CREATE',
  USER_READ = 'USER_READ',
  USER_UPDATE = 'USER_UPDATE',
  USER_DELETE = 'USER_DELETE',

  // Student Management
  STUDENT_CREATE = 'STUDENT_CREATE',
  STUDENT_READ = 'STUDENT_READ',
  STUDENT_UPDATE = 'STUDENT_UPDATE',
  STUDENT_DELETE = 'STUDENT_DELETE',
  STUDENT_BULK_UPLOAD = 'STUDENT_BULK_UPLOAD',

  // Guardian Management
  GUARDIAN_CREATE = 'GUARDIAN_CREATE',
  GUARDIAN_READ = 'GUARDIAN_READ',
  GUARDIAN_UPDATE = 'GUARDIAN_UPDATE',

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
  PAYMENT_READ = 'PAYMENT_READ',
  PAYMENT_REFUND = 'PAYMENT_REFUND',

  // Communication
  COMMUNICATION_SEND = 'COMMUNICATION_SEND',
  COMMUNICATION_BULK_SEND = 'COMMUNICATION_BULK_SEND',
  COMMUNICATION_LOG_READ = 'COMMUNICATION_LOG_READ',

  // Reports
  REPORTS_VIEW = 'REPORTS_VIEW',
  REPORTS_EXPORT = 'REPORTS_EXPORT',

  // Dashboard
  DASHBOARD_VIEW = 'DASHBOARD_VIEW',
  DASHBOARD_ADMIN = 'DASHBOARD_ADMIN',

  // Academic Structure
  ACADEMIC_YEAR_MANAGE = 'ACADEMIC_YEAR_MANAGE',
  CLASS_MANAGE = 'CLASS_MANAGE',

  // Audit
  AUDIT_LOG_READ = 'AUDIT_LOG_READ',

  // Settings
  SETTINGS_MANAGE = 'SETTINGS_MANAGE',
}

import { UserRole } from './index';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission),

  [UserRole.ADMIN]: [
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.STUDENT_CREATE,
    Permission.STUDENT_READ,
    Permission.STUDENT_UPDATE,
    Permission.STUDENT_DELETE,
    Permission.STUDENT_BULK_UPLOAD,
    Permission.GUARDIAN_CREATE,
    Permission.GUARDIAN_READ,
    Permission.GUARDIAN_UPDATE,
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
    Permission.PAYMENT_RECORD,
    Permission.PAYMENT_READ,
    Permission.COMMUNICATION_SEND,
    Permission.COMMUNICATION_BULK_SEND,
    Permission.COMMUNICATION_LOG_READ,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_ADMIN,
    Permission.ACADEMIC_YEAR_MANAGE,
    Permission.CLASS_MANAGE,
    Permission.AUDIT_LOG_READ,
    Permission.SETTINGS_MANAGE,
  ],

  [UserRole.ACCOUNTANT]: [
    Permission.STUDENT_READ,
    // Matches `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` on
    // `POST /students/bulk-upload`. Without it the endpoint is callable but
    // the "Import students" button is hidden, which reads as a broken
    // feature rather than a deliberate restriction.
    //
    // Deliberately NOT paired with STUDENT_CREATE/GUARDIAN_CREATE, even
    // though `POST /students` and `POST /guardians` carry the identical
    // `@Roles`. The consequence is odd on its face — this role can import
    // 500 students from a spreadsheet but cannot add one by hand — and it is
    // flagged rather than fixed here: [8.11.8] was scoped to unhiding the
    // import feature, and granting create rights is a separate product call.
    Permission.STUDENT_BULK_UPLOAD,
    Permission.GUARDIAN_READ,
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
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    Permission.DASHBOARD_VIEW,
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
    Permission.DASHBOARD_VIEW,
  ],

  [UserRole.PARENT]: [Permission.STUDENT_READ, Permission.FEE_READ, Permission.INVOICE_READ],

  [UserRole.STUDENT]: [Permission.STUDENT_READ, Permission.FEE_READ, Permission.INVOICE_READ],

  [UserRole.EXECUTIVE]: [
    Permission.STUDENT_READ,
    // Same reasoning as ACCOUNTANT above — the server route already admits
    // EXECUTIVE, so the UI gate matches it rather than being stricter. The
    // same STUDENT_CREATE caveat noted there applies here too.
    //
    // Also deliberately no GUARDIAN_READ: a bulk import creates guardian
    // rows as a side effect, and this role has no surface for viewing them
    // (`/guardians` is hidden and guardians are excluded from global
    // search). Granting a read that the nav does not expose is a wider
    // change than [8.11.8]; flagged rather than fixed.
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
  ],
};
