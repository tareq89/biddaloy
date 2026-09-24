import { SlotRecurrence } from '@biddaloy/shared';

/**
 * [21.5.1] Pure recurrence math — no database, no NestJS DI. The single
 * definition of "does this slot happen on this date", shared by
 * `resolve-routine.service.ts` and its tests. Never re-implement this
 * inline in a caller.
 *
 * Duplicates `toEpochDay`/weekday-of-epoch-day arithmetic rather than
 * importing `attendance-policy.util.ts` — same reasoning as
 * `school-calendar.service.ts`'s own duplication: this is calendar math
 * private to this module, not a shared attendance concern.
 */

/** Minimal shape `occursOn` needs — mirrors the load-bearing columns of
 * `RoutineSlot`. */
export interface RecurrenceSlotLike {
  weekday: number;
  recurrence: SlotRecurrence;
  recurrence_offset: number;
}

function toEpochDay(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
}

/** `0` (Sunday) .. `6` (Saturday) for a `'YYYY-MM-DD'` date, computed at
 * UTC midnight — never a local-timezone `Date` method. */
function weekdayOf(dateIso: string): number {
  const epochDay = toEpochDay(dateIso);
  // 1970-01-01 (epoch day 0) was a Thursday (weekday 4).
  return (((epochDay + 4) % 7) + 7) % 7;
}

function daysInMonth(year: number, month1based: number): number {
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

/**
 * D8: does `slot` occur on `date`? `academicYearStart` anchors the
 * `BIWEEKLY` week index — not the ISO week number, which would drift
 * against a tenant's actual year boundary.
 *
 * `MONTHLY`'s `recurrence_offset` is the slot's nth occurrence of its
 * weekday within the month, 1-indexed (`1` = first, `2` = second, ...),
 * with `-1` meaning "the last occurrence in the month" (which may be the
 * 4th or 5th depending on the month). A month with no 5th occurrence of
 * that weekday simply never matches `recurrence_offset === 5` — no
 * special-casing needed, `nth` never reaches 5 that month.
 */
export function occursOn(
  slot: RecurrenceSlotLike,
  date: string,
  academicYearStart: string,
): boolean {
  if (weekdayOf(date) !== slot.weekday) return false;

  switch (slot.recurrence) {
    case SlotRecurrence.WEEKLY:
      return true;

    case SlotRecurrence.BIWEEKLY: {
      const weekIndex = Math.floor((toEpochDay(date) - toEpochDay(academicYearStart)) / 7);
      const parity = ((weekIndex % 2) + 2) % 2;
      return parity === slot.recurrence_offset % 2;
    }

    case SlotRecurrence.MONTHLY: {
      const [year, month, day] = date.split('-').map(Number);
      const nth = Math.ceil(day / 7);
      if (slot.recurrence_offset === -1) {
        return day + 7 > daysInMonth(year, month);
      }
      return nth === slot.recurrence_offset;
    }

    default:
      return false;
  }
}
