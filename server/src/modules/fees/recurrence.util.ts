import type { RecurringScheduleRule } from './entities/recurring-schedule.entity';

/**
 * Pure date math for `RecurringSchedule.rule`. Every function here takes
 * (and returns) a date that is already in the school's local calendar day —
 * callers are responsible for converting a UTC instant to `Asia/Dhaka`
 * (`SCHOOL_TZ`, epic #637 D14) before calling in; this module never reads
 * the clock or a timezone itself, which is what keeps it unit-testable
 * without faking time.
 *
 * Dates are plain `YYYY-MM-DD` strings (matching the `date` columns these
 * rules are compared against) rather than `Date` objects, so there is no
 * ambiguity about which timezone a `Date`'s internal instant represents.
 */

function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function parseDateOnly(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function toDateOnly(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** ISO weekday: 1 = Monday .. 7 = Sunday. */
function isoWeekday(date: string): number {
  const { year, month, day } = parseDateOnly(date);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * The start of the period `date` falls in, per `rule`'s cadence:
 * - MONTHLY → the 1st of `date`'s month
 * - WEEKLY → the Monday of `date`'s week
 */
export function periodFor(date: string, rule: RecurringScheduleRule): string {
  if (rule.kind === 'MONTHLY') {
    const { year, month } = parseDateOnly(date);
    return toDateOnly(year, month, 1);
  }

  // WEEKLY: step back to Monday.
  const { year, month, day } = parseDateOnly(date);
  const weekday = isoWeekday(date);
  const monday = new Date(Date.UTC(year, month - 1, day));
  monday.setUTCDate(monday.getUTCDate() - (weekday - 1));
  return toDateOnly(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

/**
 * Whether `rule` fires on `date`.
 *
 * MONTHLY: fires on `day_of_month`, or on the month's last day when
 * `day_of_month` is `'LAST'` or exceeds the month's length (so day 30
 * safely fires on Feb 28/29 rather than never firing that month).
 *
 * WEEKLY: fires when `date`'s ISO weekday is in `rule.weekdays`.
 */
export function isDue(rule: RecurringScheduleRule, date: string): boolean {
  if (rule.kind === 'MONTHLY') {
    const { year, month, day } = parseDateOnly(date);
    const lastDay = daysInMonth(year, month);
    const target = rule.day_of_month === 'LAST' ? lastDay : Math.min(rule.day_of_month, lastDay);
    return day === target;
  }

  return rule.weekdays.includes(isoWeekday(date));
}

/**
 * The next `count` dates (inclusive of `from` itself) on which `rule`
 * fires, scanning forward day by day. Used by previews and by 16.7.2's
 * scheduler to find the next run; kept simple (a linear scan, not closed-
 * form math) since a schedule only needs a handful of upcoming dates at a
 * time and the rule shapes are small enough that this never gets slow.
 */
export function nextRunDates(rule: RecurringScheduleRule, from: string, count: number): string[] {
  const dates: string[] = [];
  const { year, month, day } = parseDateOnly(from);
  const cursor = new Date(Date.UTC(year, month - 1, day));

  // A year of days is enough headroom for both cadences (monthly rules
  // fire at least once a month, weekly rules at least once a week) without
  // risking an unbounded loop if a rule is somehow malformed.
  const maxIterations = 366;
  for (let i = 0; i < maxIterations && dates.length < count; i++) {
    const cursorDate = toDateOnly(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate(),
    );
    if (isDue(rule, cursorDate)) {
      dates.push(cursorDate);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}
