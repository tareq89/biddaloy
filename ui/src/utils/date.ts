import type { RegionConfig } from '../i18n/region-config';

import { renderDigits, toLatinDigits } from './digits';

const NONE = '—';

type Mode = 'date' | 'clock';
interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

const isBangla = (config: RegionConfig): boolean => config.locale.startsWith('bn');

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function tenantClock(date: Date, config: RegionConfig): Parts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const n = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: n('year'), m: n('month'), d: n('day'), hh: n('hour'), mm: n('minute') };
}

/**
 * Never throws; `null` means "show —". `date` mode = calendar date: local fields of a `Date`,
 * or the digits of `YYYY-MM-DD` / a serialised Postgres `date` (`YYYY-MM-DDT00:00:00.000Z`), so
 * it never shifts a day; any other instant string is read on the tenant clock. `clock` mode =
 * the tenant's wall clock for instants; a bare `YYYY-MM-DD` has no time, so it is `null`.
 */
function toParts(
  value: Date | string | null | undefined,
  config: RegionConfig,
  mode: Mode,
  allow: { month?: boolean; time?: boolean } = {},
): Parts | null {
  if (value === null || value === undefined || value === '') return null;
  const blank = { y: 0, m: 1, d: 1, hh: 0, mm: 0 };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (mode === 'clock') return tenantClock(value, config);
    return { ...blank, y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const s = toLatinDigits(value).trim();
  if (allow.time) {
    const t = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
    if (t) {
      const hh = Number(t[1]);
      const mm = Number(t[2]);
      return hh > 23 || mm > 59 ? null : { ...blank, hh, mm };
    }
  }
  if (allow.month) {
    const ym = /^(\d{4})-(\d{2})$/.exec(s);
    if (ym) {
      const m = Number(ym[2]);
      return m < 1 || m > 12 ? null : { ...blank, y: Number(ym[1]), m };
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const calendarDate = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z)?$/.test(s);
  if (mode === 'clock' && s.length === 10) return null;
  if (mode === 'clock' || !calendarDate) {
    const instant = new Date(s);
    return Number.isNaN(instant.getTime()) ? null : tenantClock(instant, config);
  }
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return isRealDate(y, m, d) ? { ...blank, y, m, d } : null;
}

function dayOrdinal(day: number, config: RegionConfig): string {
  const n = renderDigits(String(day), config.numerals);
  if (isBangla(config)) {
    if (day === 1) return `${n}লা`;
    if (day === 2 || day === 3) return `${n}রা`;
    if (day === 4) return `${n}ঠা`;
    return `${n}${day <= 18 ? 'ই' : 'শে'}`;
  }
  const last = day % 10;
  if (day >= 11 && day <= 13) return `${n}th`;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

const longDate = (p: Parts, config: RegionConfig): string =>
  `${dayOrdinal(p.d, config)} ${formatMonthName(p.m, config)}, ${renderDigits(String(p.y), config.numerals)}`;

// patterns.md §11 day-parts by 24-hour clock (not Intl, which says "অপরাহ্ণ").
const DAY_PARTS: ReadonlyArray<readonly [untilHour: number, word: string]> = [
  [4, 'রাত'],
  [6, 'ভোর'],
  [12, 'সকাল'],
  [15, 'দুপুর'],
  [18, 'বিকাল'],
  [20, 'সন্ধ্যা'],
  [24, 'রাত'],
];

function timeText(p: Parts, config: RegionConfig): string {
  const clock = renderDigits(
    `${p.hh % 12 || 12}:${String(p.mm).padStart(2, '0')}`,
    config.numerals,
  );
  if (!isBangla(config)) return `${clock} ${p.hh < 12 ? 'AM' : 'PM'}`;
  const word = DAY_PARTS.find(([until]) => p.hh < until)?.[1] ?? 'রাত';
  return `${word} ${clock}`;
}

/**
 * Long display date (D5): en `9th September, 2026`, bn `৯ই সেপ্টেম্বর, ২০২৬`. Takes a `Date` or
 * the API's strings; empty or bad input is `—`. ISO for data is `toIsoDate`.
 */
export function formatDate(value: Date | string | null | undefined, config: RegionConfig): string {
  const p = toParts(value, config, 'date');
  return p ? longDate(p, config) : NONE;
}

/** `formatDate` plus 12-hour time, on the tenant's clock (`config.timezone`), not the viewer's —
 * an administrator abroad must see logins on the school's clock, and a timestamp near midnight
 * must not shift date. */
export function formatDateTime(
  value: Date | string | null | undefined,
  config: RegionConfig,
): string {
  const p = toParts(value, config, 'clock');
  // A bare `YYYY-MM-DD` has no time to show: just the date.
  return p ? `${longDate(p, config)}, ${timeText(p, config)}` : formatDate(value, config);
}

/** `YYYY-MM-DD` from the date's local calendar fields, Latin digits always — for URLs, search
 * params, API bodies and exports (D5). Never for display; use `formatDate`. */
export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `October 2026` / `অক্টোবর ২০২৬`. Accepts `YYYY-MM`, `YYYY-MM-DD…` or a `Date`. */
export function formatMonth(value: Date | string | null | undefined, config: RegionConfig): string {
  const p = toParts(value, config, 'date', { month: true });
  return p ? `${formatMonthName(p.m, config)} ${renderDigits(String(p.y), config.numerals)}` : NONE;
}

/** Long month name for `month` 1–12 in the config locale. */
export function formatMonthName(month: number, config: RegionConfig): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return NONE;
  return new Intl.DateTimeFormat(config.locale, { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2000, month - 1, 1),
  );
}

/** 12-hour time, no seconds (D7): en `8:00 AM`, bn `সকাল ৮:০০`. A `Date` is read on the tenant
 * clock; `HH:mm[:ss]` is wall-clock and used as is. */
export function formatTime(value: Date | string | null | undefined, config: RegionConfig): string {
  const p = toParts(value, config, 'clock', { time: true });
  return p ? timeText(p, config) : NONE;
}

/** Long weekday name of a `Date` (local) or a `YYYY-MM-DD…` string. */
export function formatWeekday(
  value: Date | string | null | undefined,
  config: RegionConfig,
): string {
  // Same parsing as formatDate, so an impossible date is `—` here too.
  const p = toParts(value, config, 'date');
  if (!p) return NONE;
  return new Intl.DateTimeFormat(config.locale, { weekday: 'long', timeZone: 'UTC' }).format(
    Date.UTC(p.y, p.m - 1, p.d),
  );
}

/** Compact range (patterns.md §11): same month `8th – 10th October`, same year
 * `28th September – 3rd October, 2026`, else two full dates. */
export function formatDateRange(
  from: Date | string | null | undefined,
  to: Date | string | null | undefined,
  config: RegionConfig,
): string {
  const a = toParts(from, config, 'date');
  const b = toParts(to, config, 'date');
  if (!a || !b) return NONE;
  if (a.y !== b.y) return `${longDate(a, config)} – ${longDate(b, config)}`;
  if (a.m === b.m) {
    if (a.d === b.d) return longDate(a, config);
    return `${dayOrdinal(a.d, config)} – ${dayOrdinal(b.d, config)} ${formatMonthName(a.m, config)}`;
  }
  const year = renderDigits(String(a.y), config.numerals);
  return `${dayOrdinal(a.d, config)} ${formatMonthName(a.m, config)} – ${dayOrdinal(b.d, config)} ${formatMonthName(b.m, config)}, ${year}`;
}

/** Inverse of `toIsoDate`. Throws `RangeError` on anything that isn't a
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

/**
 * [8.12.3] "how old is this data", phrased for a human: `"5 minutes ago"`,
 * `"23 hours ago"`, `"২ দিন আগে"`.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled string table,
 * because it is the one formatter that already knows both the phrasing
 * *and* the numeral system of every locale this app ships — Bengali
 * digits come out of it for free, which is exactly the kind of thing
 * `renderDigits` exists to guarantee elsewhere and which a bespoke
 * "N minutes ago" template would quietly get wrong.
 *
 * Rounds toward the coarser unit (a 119-second-old row reads "1 minute
 * ago", not "119 seconds ago"): the caller is labelling staleness, where
 * the order of magnitude is the whole message and the precision is noise.
 * Anything under a minute is "just now" — sub-minute precision on a
 * cache-age badge invites a user to watch it tick.
 */
export function formatRelativeAge(fetchedAt: number, locale: string, now = Date.now()): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  // Clamped at 0: a server clock a few seconds ahead of the browser would
  // otherwise produce "in 3 seconds" on a badge whose entire job is to
  // say how far in the past something happened.
  const elapsedSeconds = Math.max(0, Math.round((now - fetchedAt) / 1000));

  if (elapsedSeconds < 60) return formatter.format(0, 'second');
  if (elapsedSeconds < 3600) return formatter.format(-Math.floor(elapsedSeconds / 60), 'minute');
  if (elapsedSeconds < 86_400) return formatter.format(-Math.floor(elapsedSeconds / 3600), 'hour');
  return formatter.format(-Math.floor(elapsedSeconds / 86_400), 'day');
}
