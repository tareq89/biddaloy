import { EntityManager } from 'typeorm';
import { FineTrigger } from '@biddaloy/shared';
import { attendanceAbsentTrigger } from './attendance-absent.trigger';
import { attendanceLateTrigger } from './attendance-late.trigger';

/**
 * [38.2.3] One evaluator per `FineTrigger` — turns raw records (attendance,
 * later others) into a per-student occurrence count for a date range, plus
 * the class of that student's latest matching record in range (D21, for
 * class-vs-default rule resolution).
 */
export interface FineTriggerEvaluator {
  /**
   * Occurrences per student in `[from, to]`, filtered by `scope`
   * (class/section) and `nonWorkingDates` (dates excluded entirely), plus
   * the class of the section on their latest matching record in range.
   */
  count(
    manager: EntityManager,
    tenantId: string,
    from: string,
    to: string,
    conditions: Record<string, string | number | boolean | null>,
    scope: { classId?: string; sectionId?: string },
    nonWorkingDates: string[],
  ): Promise<Map<string, { count: number; classId: string }>>;
}

/** Adding a trigger = a value in `FineTrigger` (shared/src/enums) + one
 * evaluator registered here (Epic 38 D6). */
export const FINE_TRIGGERS: Record<FineTrigger, FineTriggerEvaluator> = {
  [FineTrigger.ATTENDANCE_ABSENT]: attendanceAbsentTrigger,
  [FineTrigger.ATTENDANCE_LATE]: attendanceLateTrigger,
};
