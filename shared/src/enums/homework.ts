/**
 * Epic 22.0 homework/syllabus enums. Const-object + type pattern (not TS
 * `enum`), matching `entity-label.ts`/`exams.ts`.
 */

/** D11 — how a `Homework`'s completion is graded, fixed at creation. */
export const HomeworkGradingMode = {
  TICK: 'TICK',
  PARTIAL: 'PARTIAL',
  MARKS: 'MARKS',
} as const;
export type HomeworkGradingMode = (typeof HomeworkGradingMode)[keyof typeof HomeworkGradingMode];

/**
 * A `HomeworkAssignment`'s lifecycle (D14, D20). ACTIVE is the current
 * assignment; DEACTIVATED withdraws it without deleting the audit row;
 * SUPERSEDED means a reassignment (D20) created a newer row in its place.
 */
export const HomeworkAssignmentStatus = {
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type HomeworkAssignmentStatus =
  (typeof HomeworkAssignmentStatus)[keyof typeof HomeworkAssignmentStatus];

/**
 * D19 — one `HomeworkSubmission` row per (assignment, student). Status is
 * always present regardless of grading mode; NOT_SUBMITTED is the implicit
 * default before a student acts (D24).
 */
export const HomeworkSubmissionStatus = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  SUBMITTED: 'SUBMITTED',
  PARTIAL: 'PARTIAL',
  DONE: 'DONE',
} as const;
export type HomeworkSubmissionStatus =
  (typeof HomeworkSubmissionStatus)[keyof typeof HomeworkSubmissionStatus];

/** D19 — a syllabus topic's coverage state. */
export const SyllabusTopicStatus = {
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
} as const;
export type SyllabusTopicStatus = (typeof SyllabusTopicStatus)[keyof typeof SyllabusTopicStatus];
