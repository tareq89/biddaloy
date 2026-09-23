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
  'AcademicTerm',
  'AcademicYear',
  'ApprovalToken',
  'AttendanceDevice',
  'AttendanceRecord',
  'AttendanceSession',
  'CalendarEvent',
  'CalendarFeedToken',
  'Class',
  'ClassSection',
  'DiscountRule',
  'Enrollment',
  'Exam',
  'ExamComponent',
  'FeeGeneration',
  'FeeStructure',
  'GradingScale',
  'Guardian',
  'InvitationBatch',
  'Invoice',
  'Payment',
  'PublicHolidaySet',
  'RecurringSchedule',
  'RefreshToken',
  'ReminderBatch',
  'ReminderBatchPreview',
  'School',
  // Deprecated: `school_holidays` was renamed to `calendar_events` (Epic
  // 17). Kept read-compatible so historical audit rows with this
  // entity_type still validate — no new write ever uses it.
  'SchoolHoliday',
  'Student',
  'StudentSubjectChoice',
  'User',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
