/**
 * Epic 66.0 study-plan enums. Const-object + type pattern, matching `homework.ts`.
 */

export const LessonDeliveryStatus = {
  TAUGHT: 'TAUGHT',
  PARTLY: 'PARTLY',
  NOT_TAUGHT: 'NOT_TAUGHT',
} as const;
export type LessonDeliveryStatus = (typeof LessonDeliveryStatus)[keyof typeof LessonDeliveryStatus];

export const LessonDeliveryReason = {
  TEACHER_ABSENT: 'TEACHER_ABSENT',
  SCHOOL_CLOSED: 'SCHOOL_CLOSED',
  EXAM: 'EXAM',
  ON_LEAVE: 'ON_LEAVE',
  CANCELLED: 'CANCELLED',
  OTHER: 'OTHER',
} as const;
export type LessonDeliveryReason = (typeof LessonDeliveryReason)[keyof typeof LessonDeliveryReason];

/**
 * Reasons that mean "this was not a real teaching period" (D8, D24, D39):
 * treated like a holiday — neither expected nor owed. TEACHER_ABSENT,
 * ON_LEAVE and OTHER are NOT here: those periods are still owed.
 */
export const NOT_A_PERIOD_REASONS = [
  LessonDeliveryReason.SCHOOL_CLOSED,
  LessonDeliveryReason.EXAM,
  LessonDeliveryReason.CANCELLED,
] as const;

export const STUDY_PLAN_LIMITS = {
  maxLessons: 400,
  titleMax: 200,
  notesMax: 2000,
  periodsMin: 1,
  periodsMax: 20,
  templateNameMax: 200,
  deliveryNoteMax: 500,
  teacherEditDays: 7,
} as const;

/** CSV header, in file order (D4). Row order = lesson order. `topic` is a syllabus topic name. */
export const STUDY_PLAN_CSV_COLUMNS = ['title', 'periods', 'topic', 'notes'] as const;
