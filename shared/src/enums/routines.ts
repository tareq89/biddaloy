/**
 * Class-timetable domain enums (Epic 21.0, class routine/timetable).
 * Const-object + type pattern, like `entity-label.ts` — not TS `enum` —
 * so values are plain strings the shared package doesn't need a runtime
 * transform to consume.
 */

/** Lifecycle of one routine document. `DRAFT` is being built, `REVIEW`
 * is awaiting sign-off, `PUBLISHED` is what students/guardians/teachers
 * see. */
export const RoutineState = {
  DRAFT: 'DRAFT',
  REVIEW: 'REVIEW',
  PUBLISHED: 'PUBLISHED',
} as const;

export type RoutineState = (typeof RoutineState)[keyof typeof RoutineState];

/** What a period slot represents on the timetable grid. */
export const PeriodSlotKind = {
  CLASS: 'CLASS',
  BREAK: 'BREAK',
} as const;

export type PeriodSlotKind = (typeof PeriodSlotKind)[keyof typeof PeriodSlotKind];

/** How often a slot repeats. */
export const SlotRecurrence = {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
} as const;

export type SlotRecurrence = (typeof SlotRecurrence)[keyof typeof SlotRecurrence];

/** Status of a request to change a published routine slot. */
export const ChangeRequestState = {
  OPEN: 'OPEN',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
} as const;

export type ChangeRequestState = (typeof ChangeRequestState)[keyof typeof ChangeRequestState];
