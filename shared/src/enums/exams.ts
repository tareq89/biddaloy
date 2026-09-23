/**
 * Epic 19.0 exam/marks/result enums. Const-object + type pattern (not TS
 * `enum`), matching `entity-label.ts`.
 */

/** What kind of exam this is (19.2.1's `Exam` entity). */
export const ExamKind = {
  TERM: 'TERM',
  MONTHLY: 'MONTHLY',
  MODEL: 'MODEL',
  OTHER: 'OTHER',
} as const;
export type ExamKind = (typeof ExamKind)[keyof typeof ExamKind];

/**
 * An exam's lifecycle state (D12). DRAFT → PROCESSED → PUBLISHED.
 * Reopening a PUBLISHED exam back to PROCESSED requires `@RequireApproval`
 * plus an audit record (19.5.1) — this enum only names the states.
 */
export const ExamStatus = {
  DRAFT: 'DRAFT',
  PROCESSED: 'PROCESSED',
  PUBLISHED: 'PUBLISHED',
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

/** What an `ExamComponent` measures (19.2.1). */
export const ExamComponentKind = {
  WRITTEN: 'WRITTEN',
  MCQ: 'MCQ',
  VIVA: 'VIVA',
  LAB: 'LAB',
  PRACTICAL: 'PRACTICAL',
  MONTHLY_TEST: 'MONTHLY_TEST',
  // [19.3.1] D11 — read-only, computed from AttendanceRecord.
  ATTENDANCE: 'ATTENDANCE',
  OTHER: 'OTHER',
} as const;
export type ExamComponentKind = (typeof ExamComponentKind)[keyof typeof ExamComponentKind];

/**
 * Where an `ExamComponent`'s marks come from. MANUAL is entered on the
 * marks grid; DERIVED is computed by the server (currently only the
 * ATTENDANCE component kind, D11) and never accepts direct entry.
 */
export const ExamComponentSource = {
  MANUAL: 'MANUAL',
  DERIVED: 'DERIVED',
} as const;
export type ExamComponentSource = (typeof ExamComponentSource)[keyof typeof ExamComponentSource];

/** A student's presence status for one exam component's mark. */
export const MarkStatus = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  EXEMPT: 'EXEMPT',
} as const;
export type MarkStatus = (typeof MarkStatus)[keyof typeof MarkStatus];

/**
 * D12 — per section-subject marks-entry grid state. DRAFT is editable;
 * SUBMITTED locks entry (subject to the exam's own ExamStatus).
 */
export const MarkGridState = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
} as const;
export type MarkGridState = (typeof MarkGridState)[keyof typeof MarkGridState];
