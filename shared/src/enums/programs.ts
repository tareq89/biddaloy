/**
 * [34.1.1] Epic 34.0 programs/milestones. Const-object + type pattern,
 * matching `exams.ts`.
 */

/**
 * A student's enrollment status in a `Program` (D2, D19, D20). ACTIVE is the
 * default on enrollment; COMPLETED and WITHDRAWN are terminal.
 */
export const ProgramEnrollmentStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type ProgramEnrollmentStatus =
  (typeof ProgramEnrollmentStatus)[keyof typeof ProgramEnrollmentStatus];
