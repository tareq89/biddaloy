import type { RegionConfig } from '../i18n/region-config';

import { renderDigits, toLatinDigits } from './digits';

/**
 * Numeric ISO-shaped date (`YYYY-MM-DD`), digits rendered per
 * `config.numerals` — deliberately not a localized month-name format
 * (`"৫ জানুয়ারি ২০২৪"`), since that needs real translated month names,
 * which is [8.7.1]'s i18next job, not a formatter's. A locale-aware
 * calendar UI ([8.6.3]'s `DatePicker`) composes this with real i18n later.
 */
export function formatDate(date: Date, config: RegionConfig): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return renderDigits(`${year}-${month}-${day}`, config.numerals);
}

/**
 * `formatDate` plus wall-clock time (`YYYY-MM-DD HH:mm`), for rows where
 * the time of day matters — e.g. login history, where three same-day
 * logins must stay distinguishable. Same digit-rendering rules as
 * `formatDate`.
 */
export function formatDateTime(date: Date, config: RegionConfig): string {
  // Rendered in the tenant's own time zone (`config.timezone`), not the
  // viewer's — an administrator abroad must see logins on the school's
  // clock, and a timestamp near midnight must not shift date.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return renderDigits(
    `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`,
    config.numerals,
  );
}

/** Inverse of `formatDate`. Throws `RangeError` on anything that isn't a
 * `YYYY-MM-DD` shape in either digit system, or a calendar date that
 * doesn't exist (`2024-02-30`) — `new Date(...)` silently rolls invalid
 * dates forward instead of rejecting them, which is exactly the "mangles
 * rather than fails" behaviour this module avoids elsewhere. */
export function parseDate(input: string): Date {
  const cleaned = toLatinDigits(input).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (!match) {
    throw new RangeError(`parseDate: "${input}" is not a YYYY-MM-DD date`);
  }

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new RangeError(`parseDate: "${input}" is not a real calendar date`);
  }

  return date;
}

/**
 * Parses a server `date`-column value into a **local** calendar date.
 *
 * A Postgres `date` column (e.g. `Invoice.issued_date`) round-trips
 * through the API as an ISO datetime string — `"2024-01-05T00:00:00.000Z"`,
 * not a bare `"2024-01-05"` — because TypeORM reads the column into a JS
 * `Date` and Nest's JSON serialization calls `.toISOString()` on it.
 * Handing that string straight to `new Date(...)` and then reading
 * `.getDate()`/`formatDate` (both local-timezone) rolls the displayed date
 * back a day for anyone west of UTC: `new Date('2024-01-05T00:00:00.000Z')`
 * is 2024-01-04 18:00 in `America/Los_Angeles`. Slicing to the date-only
 * prefix and handing that to `parseDate` (which builds the `Date` from
 * local calendar fields, no UTC round-trip) avoids the shift.
 */
export function parseServerDate(value: string): Date {
  return parseDate(value.slice(0, 10));
}

/**
 * Whether a server due date has actually **passed** — i.e. is strictly
 * earlier than today.
 *
 * The obvious spelling, `parseServerDate(due).getTime() < now.getTime()`,
 * is wrong in a way that only shows up on one day per fee:
 * `parseServerDate` returns *local midnight*, so from 00:00 on the due
 * date itself the comparison is already true and a fee is reported
 * overdue on the very day the school asked for it. Comparing against the
 * start of today instead makes "due today" current, and only yesterday
 * and earlier late.
 *
 * This is the client-side twin of `fee-dues.service.ts`'s
 * `months_overdue` predicate (`sf.due_date < CURRENT_DATE`). The two must
 * agree, or a badge here contradicts a count from the server for the
 * same fee — so change them together or not at all.
 */
export function isPastDueDate(dueDate: string | null, now: Date): boolean {
  if (dueDate === null) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parseServerDate(dueDate).getTime() < startOfToday.getTime();
}

/** Which academic-year window `date` falls into, per
 * `config.academicYear.startMonth` (1–12). A school on a January start
 * never straddles a calendar year (`startYear === endYear`); one on, say,
 * a July start does. */
export function getAcademicYear(
  date: Date,
  config: RegionConfig,
): { startYear: number; endYear: number } {
  const { startMonth } = config.academicYear;
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError(
      `getAcademicYear: config.academicYear.startMonth must be an integer from 1 (January) to ` +
        `12 (December), got ${startMonth}`,
    );
  }
  if (startMonth === 1) {
    return { startYear: date.getFullYear(), endYear: date.getFullYear() };
  }

  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const startYear = month >= startMonth ? year : year - 1;
  return { startYear, endYear: startYear + 1 };
}

/** "2024" for a January-start academic year, "2024–2025" for one that
 * straddles two calendar years — always unambiguous about which years are
 * in play, per this issue's acceptance criterion. */
export function formatAcademicYear(date: Date, config: RegionConfig): string {
  const { startYear, endYear } = getAcademicYear(date, config);
  const label = startYear === endYear ? String(startYear) : `${startYear}–${endYear}`;
  return renderDigits(label, config.numerals);
}
