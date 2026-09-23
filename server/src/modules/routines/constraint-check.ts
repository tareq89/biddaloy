import { PeriodSlotKind, SlotRecurrence } from '@biddaloy/shared';

/**
 * [21.4.1] Pure constraint-checking module. No repository access, no
 * NestJS DI — `RoutineSlotsService` (real writes) and `GreedyFillService`
 * (proposals) both call the same functions here so "does this candidate
 * slot clash with what's already there" is answered identically in both
 * places (D9 invariant: one implementation, never two that can drift).
 *
 * Everything a caller needs to check a candidate slot is passed in
 * explicitly — the candidate itself, the existing slots it would coexist
 * with (already tenant/routine-scoped by the caller), the period-slot
 * metadata (kind/shift window), and the tenant's `RoutineSettings`. This
 * module never reaches into a database itself.
 */

/** Minimal shape of a slot (existing or candidate) needed to check it
 * against others. Mirrors the load-bearing columns of `RoutineSlot`, not
 * the whole entity, so callers (including tests) can build these by hand
 * without touching TypeORM. */
export interface SlotLike {
  /** `undefined` for a not-yet-saved candidate. Used only so a slot is
   * never checked against itself when the caller includes it in
   * `existing` (e.g. re-validating after a partial update). */
  id?: string;
  section_id: string;
  period_slot_id: string;
  weekday: number;
  /** `PeriodSlot.sequence` of `period_slot_id` — needed to detect
   * consecutive-period runs for the soft `maxConsecutivePeriods`
   * warning. Denormalized onto the slot by the caller (it's the same
   * value the period-slot row already carries). */
  period_sequence: number;
  subject_id: string;
  room_id: string | null;
  recurrence: SlotRecurrence;
  recurrence_offset: number;
  valid_from: string;
  /** `null` = still in force. */
  valid_to: string | null;
  /** Teacher ids assigned to this slot (via `RoutineSlotTeacher`). */
  teacher_ids: string[];
}

/** The period-slot metadata a candidate references — enough to tell a
 * `BREAK` slot from a class period. */
export interface PeriodSlotMeta {
  id: string;
  kind: PeriodSlotKind;
}

export interface RoutineConstraintSettings {
  maxPeriodsPerTeacherPerDay?: number | null;
  maxConsecutivePeriods?: number | null;
}

/** Longest run of consecutive `period_sequence` values (including
 * `candidateSeq`) among a teacher's slots on one weekday. */
function longestConsecutiveRun(sequences: number[], candidateSeq: number): number {
  const all = Array.from(new Set([...sequences, candidateSeq])).sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < all.length; i++) {
    run = all[i] === all[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export type ViolationCode =
  | 'BREAK_SLOT'
  | 'TEACHER_DOUBLE_BOOKED'
  | 'SECTION_DOUBLE_BOOKED'
  | 'ROOM_DOUBLE_BOOKED'
  | 'TEACHER_OVER_DAILY_LIMIT';

export type WarningCode = 'TEACHER_NOT_ASSIGNED' | 'TEACHER_OVER_CONSECUTIVE_LIMIT';

export interface Violation {
  code: ViolationCode;
  message: string;
}

export interface Warning {
  code: WarningCode;
  message: string;
}

export interface ConstraintCheckResult {
  violations: Violation[];
  warnings: Warning[];
}

/**
 * D8 recurrence intersection — the single most likely source of a wrong
 * "no conflict" if it's wrong. Two slots recur on the same weekday
 * forever unless told otherwise; `WEEKLY` hits every occurrence, so it
 * intersects anything. `BIWEEKLY` only fires on alternating weeks — two
 * `BIWEEKLY` slots clash only when their `recurrence_offset` (which of
 * the two weeks) matches. `MONTHLY` is treated as "could fall on any
 * week" (no week-parity tracking exists for it), so it always intersects
 * `WEEKLY` and `BIWEEKLY` — a monthly slot is a superset risk, not one
 * this module can safely wave through.
 */
export function recurrenceIntersects(
  a: { recurrence: SlotRecurrence; recurrence_offset: number },
  b: { recurrence: SlotRecurrence; recurrence_offset: number },
): boolean {
  if (a.recurrence === SlotRecurrence.MONTHLY || b.recurrence === SlotRecurrence.MONTHLY) {
    return true;
  }
  if (a.recurrence === SlotRecurrence.WEEKLY || b.recurrence === SlotRecurrence.WEEKLY) {
    return true;
  }
  // Both BIWEEKLY: only the same-offset week actually coincides.
  return a.recurrence_offset === b.recurrence_offset;
}

/** Half-open `[valid_from, valid_to)` date-range overlap. `null` valid_to
 * means "still in force" — treated as unbounded. */
export function dateRangesOverlap(
  a: { valid_from: string; valid_to: string | null },
  b: { valid_from: string; valid_to: string | null },
): boolean {
  const aEnd = a.valid_to ?? '9999-12-31';
  const bEnd = b.valid_to ?? '9999-12-31';
  return a.valid_from < bEnd && b.valid_from < aEnd;
}

/** Two slots "coexist" — actually compete for the same weekday-time —
 * only if their weekday, recurrence and effective-date range all
 * intersect. This is the gate every hard-violation check below runs a
 * candidate through before comparing teacher/section/room. */
function slotsCoexist(a: SlotLike, b: SlotLike): boolean {
  return (
    a.weekday === b.weekday &&
    // Same PeriodSlot = same time-of-day in the same shift. Two slots on
    // the same weekday but different periods (e.g. Monday period 1 and
    // Monday period 2) don't compete for anything.
    a.period_slot_id === b.period_slot_id &&
    recurrenceIntersects(a, b) &&
    dateRangesOverlap(a, b) &&
    a.id !== b.id
  );
}

/**
 * Check one candidate slot against the slots it would coexist with.
 * `existing` should already be scoped by the caller to the same
 * routine/tenant — this function does no tenant filtering itself.
 */
export function checkSlot(
  candidate: SlotLike,
  existing: SlotLike[],
  periodSlot: PeriodSlotMeta,
  assignedSections: ReadonlySet<string>,
  settings: RoutineConstraintSettings,
): ConstraintCheckResult {
  const violations: Violation[] = [];
  const warnings: Warning[] = [];

  if (periodSlot.kind === PeriodSlotKind.BREAK) {
    violations.push({
      code: 'BREAK_SLOT',
      message: 'Cannot schedule a class into a BREAK period slot.',
    });
  }

  const coexisting = existing.filter((s) => slotsCoexist(candidate, s));

  // Same section, two subjects at once.
  const sectionClash = coexisting.some((s) => s.section_id === candidate.section_id);
  if (sectionClash) {
    violations.push({
      code: 'SECTION_DOUBLE_BOOKED',
      message: 'This section already has a class scheduled at this weekday/time.',
    });
  }

  // Same room, two sections at once.
  if (candidate.room_id) {
    const roomClash = coexisting.some((s) => s.room_id === candidate.room_id);
    if (roomClash) {
      violations.push({
        code: 'ROOM_DOUBLE_BOOKED',
        message: 'This room is already booked at this weekday/time.',
      });
    }
  }

  // Same teacher, two sections at once.
  const teacherClash = coexisting.some((s) =>
    s.teacher_ids.some((t) => candidate.teacher_ids.includes(t)),
  );
  if (teacherClash) {
    violations.push({
      code: 'TEACHER_DOUBLE_BOOKED',
      message: 'A teacher on this slot is already teaching another section at this weekday/time.',
    });
  }

  // Daily period-count cap per teacher (hard, D-cited in RoutineSettings).
  // `existing` includes historical rows a D4 edit has already closed
  // (`loadExisting` loads every slot in the routine, not just active
  // ones) — date-range-overlap-gate them out here too, same as
  // `slotsCoexist` does for the clash checks above, so a superseded row
  // never counts toward today's cap.
  if (settings.maxPeriodsPerTeacherPerDay != null) {
    for (const teacherId of candidate.teacher_ids) {
      const dailyCount =
        existing.filter(
          (s) =>
            s.weekday === candidate.weekday &&
            s.teacher_ids.includes(teacherId) &&
            dateRangesOverlap(candidate, s),
        ).length + 1;
      if (dailyCount > settings.maxPeriodsPerTeacherPerDay) {
        violations.push({
          code: 'TEACHER_OVER_DAILY_LIMIT',
          message: `Teacher would exceed the ${settings.maxPeriodsPerTeacherPerDay}-period/day cap.`,
        });
        break;
      }
    }
  }

  // Soft warning: teacher not assigned to this section/subject in
  // TeacherClassSection.
  const unassigned = candidate.teacher_ids.filter((t) => !assignedSections.has(t));
  if (unassigned.length > 0) {
    warnings.push({
      code: 'TEACHER_NOT_ASSIGNED',
      message: 'Assigned teacher is not registered against this section/subject.',
    });
  }

  // Soft warning: consecutive-period run (same weekday, any recurrence —
  // "in a row" is a same-day layout concern, not a recurrence-intersection
  // one, so this checks the raw weekday match rather than `slotsCoexist`).
  // Same historical-row gate as the daily-cap check above.
  if (settings.maxConsecutivePeriods != null) {
    for (const teacherId of candidate.teacher_ids) {
      const sameDaySequences = existing
        .filter(
          (s) =>
            s.weekday === candidate.weekday &&
            s.teacher_ids.includes(teacherId) &&
            dateRangesOverlap(candidate, s),
        )
        .map((s) => s.period_sequence);
      const run = longestConsecutiveRun(sameDaySequences, candidate.period_sequence);
      if (run > settings.maxConsecutivePeriods) {
        warnings.push({
          code: 'TEACHER_OVER_CONSECUTIVE_LIMIT',
          message: `Teacher would teach ${run} consecutive periods, above the ${settings.maxConsecutivePeriods}-period soft limit.`,
        });
        break;
      }
    }
  }

  return { violations, warnings };
}
