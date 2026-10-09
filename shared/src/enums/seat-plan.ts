/**
 * Epic 25.0 seat-plan enums. Const-object + type pattern (not TS `enum`),
 * matching `entity-label.ts`/`exams.ts`/`homework.ts`.
 */

/** A `SeatPlan`'s lifecycle. DRAFT can still be edited; PUBLISHED locks its
 * schedules (D6) and its allocations become visible to invigilators. */
export const SeatPlanStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
} as const;
export type SeatPlanStatus = (typeof SeatPlanStatus)[keyof typeof SeatPlanStatus];

/** How seats are assigned within a room when a `SeatPlan` is generated. */
export const SeatOrderMode = {
  SEQUENTIAL: 'SEQUENTIAL',
  RANDOM: 'RANDOM',
} as const;
export type SeatOrderMode = (typeof SeatOrderMode)[keyof typeof SeatOrderMode];
