import { Permission } from '@biddaloy/shared';

/**
 * [8.14.17]'s one map: every staff route's TanStack **route ID** (not
 * path — index routes carry a trailing slash, `/_staff/students/`, and
 * `routes/_staff.tsx` wraps this in `RequirePermission` per route match)
 * to the single permission that route needs.
 *
 * The value type is deliberately non-optional (`Permission`, never
 * `undefined`) — "no gate" is not an expressible value here. A route
 * added later without an entry fails `route-permissions.test.ts`'s drift
 * guard rather than silently rendering to everyone.
 *
 * Every route gets **blanket refusal matching nav visibility** — the
 * same permission `_staff.tsx`'s nav item (or, where a route has no nav
 * item of its own, its data) already gates on. No route ships a
 * reduced-but-still-visible read-only view in this ticket: that would
 * require *granting* a permission (e.g. `INVOICE_READ` to `EXECUTIVE`)
 * in `shared/src/enums/permissions.ts`'s `ROLE_PERMISSIONS`, a product
 * decision this client-only ticket does not make. See `docs/architecture
 * /frontend.md`'s route-access section for the full table and that
 * decision's writeup.
 */
export const STAFF_ROUTE_PERMISSIONS: Record<string, Permission> = {
  '/_staff/dashboard': Permission.DASHBOARD_VIEW,
  // [8.14.11]: this is the signed-in user's own session history, not
  // tenant data — `DASHBOARD_VIEW` is the same "any staff role that
  // reaches the shell" baseline `/_staff/dashboard` already uses, not a
  // resource-specific permission this route doesn't need.
  '/_staff/notifications': Permission.DASHBOARD_VIEW,
  '/_staff/students/': Permission.STUDENT_READ,
  '/_staff/students/new': Permission.STUDENT_CREATE,
  '/_staff/students/import': Permission.STUDENT_BULK_UPLOAD,
  '/_staff/students/$studentId': Permission.STUDENT_READ,
  '/_staff/students/$studentId_/edit': Permission.STUDENT_UPDATE,
  '/_staff/guardians/': Permission.GUARDIAN_READ,
  '/_staff/guardians/$guardianId': Permission.GUARDIAN_READ,
  '/_staff/staff/': Permission.USER_READ,
  '/_staff/staff/$userId': Permission.USER_READ,
  '/_staff/fees/': Permission.FEE_STRUCTURE_READ,
  '/_staff/fees/dues': Permission.FEE_COLLECT,
  '/_staff/fees/generate': Permission.FEE_GENERATE,
  '/_staff/fee-structures/': Permission.FEE_STRUCTURE_READ,
  '/_staff/invoices/': Permission.INVOICE_READ,
  '/_staff/invoices/$invoiceId': Permission.INVOICE_READ,
  '/_staff/payments/record': Permission.PAYMENT_RECORD,
  '/_staff/communications/send': Permission.COMMUNICATION_SEND,
  '/_staff/communications/reminders': Permission.COMMUNICATION_BULK_SEND,
  '/_staff/communications/batches/': Permission.COMMUNICATION_BULK_SEND,
  '/_staff/communications/batches/$batchId': Permission.COMMUNICATION_BULK_SEND,
  '/_staff/academic-years/': Permission.ACADEMIC_YEAR_MANAGE,
  '/_staff/academic-years/$academicYearId': Permission.ACADEMIC_YEAR_MANAGE,
  '/_staff/classes/': Permission.CLASS_MANAGE,
  '/_staff/classes/$classId': Permission.CLASS_MANAGE,
  '/_staff/audit-logs/': Permission.AUDIT_LOG_READ,
  '/_staff/settings': Permission.SETTINGS_MANAGE,
};
