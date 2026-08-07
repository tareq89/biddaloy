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
