/**
 * One authoritative list of the `entity_type` strings the server ever
 * writes to `audit_logs.entity_type`. `AuditLog.entity_type` stays a
 * free-form varchar column (no DB enum) — this catalog is the compile-time
 * and test-time contract that keeps every literal server code writes, and
 * every option the client filter offers, in sync.
 *
 * Sourced from every `entity_type: '...'` literal under `server/src`
 * (`rg -o "entity_type: '[A-Za-z_]+'" server/src -g '!*.spec.ts' | sort -u`),
 * kept alphabetical so additions are an easy diff.
 *
 * Adding a new literal in a server service without adding it here is a
 * compile error (`AuditService.record`'s `entity_type` is typed
 * `AuditEntityType`) and fails `server/src/modules/audit/entity-catalog.spec.ts`.
 */
export const AUDIT_ENTITY_TYPES = [
  'AbsenceNoticePreview',
  'AttendanceDevice',
  'AttendanceRecord',
  'AttendanceSession',
  'Class',
  'ClassSection',
  'FeeStructure',
  'Guardian',
  'InvitationBatch',
  'Invoice',
  'Payment',
  'RefreshToken',
  'ReminderBatch',
  'ReminderBatchPreview',
  'School',
  'SchoolHoliday',
  'Student',
  'User',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
