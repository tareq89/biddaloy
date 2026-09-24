import type { TabSpec } from '../../codec/tab-spec';
import { shiftsTab } from './shifts.tab';
import { periodSlotsTab } from './period-slots.tab';
import { roomsTab } from './rooms.tab';
import { routinesTab } from './routines.tab';
import { routineSlotsTab } from './routine-slots.tab';
import { routineSlotTeachersTab } from './routine-slot-teachers.tab';
import { routineSubstitutionsTab } from './routine-substitutions.tab';
import { routineChangeRequestsTab } from './routine-change-requests.tab';

/**
 * Tabs owned by the routines lane (Epic 21.0). Registered in dependency
 * order: `shifts` and `rooms` first (depend only on `school`), then
 * `period_slots` (depends on `shifts`), then `routines` (depends on
 * `academic_years`), then `routine_slots` (depends on `routines`,
 * `sections`, `period_slots`, `subjects`, `rooms`), then the three tabs
 * that reference a `routine_slot`: `routine_slot_teachers`,
 * `routine_substitutions`, `routine_change_requests`.
 */
export const routinesTabs: TabSpec<any, any>[] = [
  shiftsTab,
  periodSlotsTab,
  roomsTab,
  routinesTab,
  routineSlotsTab,
  routineSlotTeachersTab,
  routineSubstitutionsTab,
  routineChangeRequestsTab,
];

export {
  shiftsTab,
  periodSlotsTab,
  roomsTab,
  routinesTab,
  routineSlotsTab,
  routineSlotTeachersTab,
  routineSubstitutionsTab,
  routineChangeRequestsTab,
};
export type { ShiftRow } from './shifts.tab';
export type { PeriodSlotRow } from './period-slots.tab';
export type { RoomRow } from './rooms.tab';
export type { RoutineRow } from './routines.tab';
export type { RoutineSlotRow } from './routine-slots.tab';
export type { RoutineSlotTeacherRow } from './routine-slot-teachers.tab';
export type { RoutineSubstitutionRow } from './routine-substitutions.tab';
export type { RoutineChangeRequestRow } from './routine-change-requests.tab';
