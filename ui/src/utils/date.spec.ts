import { afterEach, describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '../i18n/region-config';

import {
  formatAcademicYear,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMonth,
  formatMonthName,
  formatRelativeAge,
  formatTime,
  getAcademicYear,
  isPastDueDate,
  parseDate,
  parseServerDate,
  toIsoDate,
} from './date';

const julyStart: RegionConfig = { ...REGION_BD_EN, academicYear: { startMonth: 7 } };
const julyStartBn: RegionConfig = { ...REGION_BD_BN, academicYear: { startMonth: 7 } };

describe('formatDate', () => {
  it('long form, Latin digits', () => {
    expect(formatDate(new Date(2024, 0, 5), REGION_BD_EN)).toBe('5th January, 2024');
  });

  it('renders Bengali ordinal, month and digits for a Bengali config', () => {
    expect(formatDate(new Date(2024, 0, 5), REGION_BD_BN)).toBe('৫ই জানুয়ারি, ২০২৪');
  });

  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [31, '31st'],
  ])('English ordinal for day %i', (day, ordinal) => {
    expect(formatDate(new Date(2026, 9, day), REGION_BD_EN)).toBe(`${ordinal} October, 2026`);
  });

  it.each([
    [1, '১লা'],
    [2, '২রা'],
    [3, '৩রা'],
    [4, '৪ঠা'],
    [5, '৫ই'],
    [18, '১৮ই'],
    [19, '১৯শে'],
    [31, '৩১শে'],
  ])('Bangla ordinal for day %i', (day, ordinal) => {
    expect(formatDate(new Date(2026, 9, day), REGION_BD_BN)).toBe(`${ordinal} অক্টোবর, ২০২৬`);
  });

  it('accepts the API date string', () => {
    expect(formatDate('2026-09-09', REGION_BD_EN)).toBe('9th September, 2026');
  });

  it('does not shift a `date`-column ISO datetime west of UTC', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatDate('2026-09-09T00:00:00.000Z', REGION_BD_EN)).toBe('9th September, 2026');
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it.each(['', null, undefined, 'garbage', '2026-02-30', new Date(Number.NaN)])(
    'shows the none value for %s',
    (value) => {
      expect(formatDate(value, REGION_BD_EN)).toBe('—');
    },
  );

  it('digits follow numerals, words follow locale', () => {
    expect(formatDate('2026-09-09', { ...REGION_BD_BN, numerals: 'latin' })).toBe(
      '9ই সেপ্টেম্বর, 2026',
    );
  });
});

describe('formatTime', () => {
  it.each([
    ['00:00', 'রাত ১২:০০'],
    ['03:59', 'রাত ৩:৫৯'],
    ['04:00', 'ভোর ৪:০০'],
    ['05:59', 'ভোর ৫:৫৯'],
    ['06:00', 'সকাল ৬:০০'],
    ['11:59', 'সকাল ১১:৫৯'],
    ['12:00', 'দুপুর ১২:০০'],
    ['14:59', 'দুপুর ২:৫৯'],
    ['15:00', 'বিকাল ৩:০০'],
    ['17:59', 'বিকাল ৫:৫৯'],
    ['18:00', 'সন্ধ্যা ৬:০০'],
    ['19:59', 'সন্ধ্যা ৭:৫৯'],
    ['20:00', 'রাত ৮:০০'],
    ['23:59', 'রাত ১১:৫৯'],
  ])('Bangla day-part %s', (input, expected) => {
    expect(formatTime(input, REGION_BD_BN)).toBe(expected);
  });

  it.each([
    ['08:00', '8:00 AM'],
    ['08:00:00', '8:00 AM'],
    ['12:30', '12:30 PM'],
    ['00:05', '12:05 AM'],
  ])('English %s', (input, expected) => {
    expect(formatTime(input, REGION_BD_EN)).toBe(expected);
  });

  it('reads a Date on the tenant clock', () => {
    expect(formatTime(new Date(Date.UTC(2026, 7, 25, 3, 5)), REGION_BD_EN)).toBe('9:05 AM');
  });

  it.each(['25:00', ''])('shows the none value for %j', (value) => {
    expect(formatTime(value, REGION_BD_EN)).toBe('—');
  });
});

describe('formatMonth', () => {
  it('formats YYYY-MM, YYYY-MM-DD and Date in both languages', () => {
    expect(formatMonth('2026-10', REGION_BD_EN)).toBe('October 2026');
    expect(formatMonth('2026-10', REGION_BD_BN)).toBe('অক্টোবর ২০২৬');
    expect(formatMonth('2026-10-08', REGION_BD_EN)).toBe('October 2026');
    expect(formatMonth(new Date(2026, 9, 8), REGION_BD_EN)).toBe('October 2026');
  });

  it('shows the none value for a bad month', () => {
    expect(formatMonth('2026-13', REGION_BD_EN)).toBe('—');
  });
});

describe('parseDate', () => {
  it('parses a YYYY-MM-DD string', () => {
    const date = parseDate('2024-01-05');
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(5);
  });

  it('accepts Bengali digits', () => {
    const date = parseDate('২০২৪-০১-০৫');
    expect(date.getFullYear()).toBe(2024);
  });

  it('round-trips through toIsoDate', () => {
    expect(toIsoDate(parseDate('2024-01-05'))).toBe('2024-01-05');
  });

  it('rejects a malformed string', () => {
    expect(() => parseDate('not a date')).toThrow(RangeError);
  });

  it('rejects a calendar date that does not exist', () => {
    expect(() => parseDate('2024-02-30')).toThrow(RangeError);
  });
});

describe('getAcademicYear', () => {
  it('is the plain calendar year when the academic year starts in January', () => {
    expect(getAcademicYear(new Date(2024, 5, 15), REGION_BD_EN)).toEqual({
      startYear: 2024,
      endYear: 2024,
    });
  });

  it('straddles two calendar years for a mid-year start month, before the start month', () => {
    expect(getAcademicYear(new Date(2024, 3, 1), julyStart)).toEqual({
      startYear: 2023,
      endYear: 2024,
    });
  });

  it('straddles two calendar years for a mid-year start month, on/after the start month', () => {
    expect(getAcademicYear(new Date(2024, 6, 1), julyStart)).toEqual({
      startYear: 2024,
      endYear: 2025,
    });
  });

  it.each([0, 13, -1, 1.5, NaN])(
    'rejects a config.academicYear.startMonth of %s rather than quietly producing a wrong year',
    (startMonth) => {
      const config: RegionConfig = { ...REGION_BD_EN, academicYear: { startMonth } };
      expect(() => getAcademicYear(new Date(2024, 5, 15), config)).toThrow(RangeError);
    },
  );
});

describe('formatAcademicYear', () => {
  it('states a single year unambiguously when the window does not straddle', () => {
    expect(formatAcademicYear(new Date(2024, 5, 15), REGION_BD_EN)).toBe('2024');
  });

  it('states both calendar years unambiguously when the window straddles', () => {
    expect(formatAcademicYear(new Date(2024, 6, 1), julyStart)).toBe('2024–2025');
  });

  it('renders Bengali digits in a straddling label', () => {
    expect(formatAcademicYear(new Date(2024, 6, 1), julyStartBn)).toBe('২০২৪–২০২৫');
  });
});

describe('parseServerDate', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('does not roll a `date`-column value back a day in a UTC-negative timezone', () => {
    // Regression: `Invoice.issued_date` (a Postgres `date` column) reaches
    // the client as `"2024-01-05T00:00:00.000Z"`, not a bare
    // `"2024-01-05"` — `new Date(...)` on that full string, then reading
    // local-timezone fields, showed 2024-01-04 in `America/Los_Angeles`.
    process.env.TZ = 'America/Los_Angeles';
    const date = parseServerDate('2024-01-05T00:00:00.000Z');
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(5);
  });

  it('accepts a bare date-only string the same way', () => {
    const date = parseServerDate('2024-01-05');
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(5);
  });
});

describe('isPastDueDate', () => {
  // Mid-afternoon, so a naive `parseServerDate(due) < now` comparison
  // would already be true for a fee due today — that is the bug these
  // cases pin.
  const now = new Date(2026, 7, 25, 14, 30);

  it('does not call a fee due today overdue', () => {
    expect(isPastDueDate('2026-08-25T00:00:00.000Z', now)).toBe(false);
  });

  it('does not call a fee due today overdue at one minute to midnight', () => {
    expect(isPastDueDate('2026-08-25T00:00:00.000Z', new Date(2026, 7, 25, 23, 59))).toBe(false);
  });

  it('calls yesterday overdue', () => {
    expect(isPastDueDate('2026-08-24T00:00:00.000Z', now)).toBe(true);
  });

  it('does not call a future due date overdue', () => {
    expect(isPastDueDate('2026-08-26T00:00:00.000Z', now)).toBe(false);
  });

  it('treats a missing due date as not overdue', () => {
    expect(isPastDueDate(null, now)).toBe(false);
  });
});

describe('formatDateTime', () => {
  // REGION_BD_* pin timezone: 'Asia/Dhaka' (UTC+6, no DST) — instants are
  // built in UTC so these assertions hold in any test-runner time zone.
  it('renders the instant on the tenant clock, 12-hour, no seconds', () => {
    const date = new Date(Date.UTC(2026, 7, 25, 3, 5)); // 09:05 in Dhaka
    expect(formatDateTime(date, REGION_BD_EN)).toBe('25th August, 2026, 9:05 AM');
  });

  it('renders time digits in the configured numeral system', () => {
    const date = new Date(Date.UTC(2026, 7, 25, 17, 50)); // 23:50 in Dhaka
    expect(formatDateTime(date, REGION_BD_BN)).toBe('২৫শে আগস্ট, ২০২৬, রাত ১১:৫০');
  });

  it('keeps the tenant-local date across the UTC midnight boundary', () => {
    // 19:00 UTC on the 24th is already 01:00 on the 25th in Dhaka.
    const date = new Date(Date.UTC(2026, 7, 24, 19, 0));
    expect(formatDateTime(date, REGION_BD_EN)).toBe('25th August, 2026, 1:00 AM');
  });
});

describe('formatRelativeAge', () => {
  const NOW = Date.parse('2026-08-28T12:00:00Z');

  it('says "now" for anything under a minute, rather than ticking seconds', () => {
    expect(formatRelativeAge(NOW - 30_000, 'en', NOW)).toBe('now');
  });

  it('rounds toward the coarser unit', () => {
    // 119s is "1 minute ago", not "119 seconds ago" — the order of
    // magnitude is the message on a staleness badge.
    expect(formatRelativeAge(NOW - 119_000, 'en', NOW)).toBe('1 minute ago');
  });

  it.each([
    [5 * 60_000, '5 minutes ago'],
    [2 * 60 * 60_000, '2 hours ago'],
    [23 * 60 * 60_000, '23 hours ago'],
    [3 * 24 * 60 * 60_000, '3 days ago'],
  ])('formats an age of %ims as "%s"', (ageMs, expected) => {
    expect(formatRelativeAge(NOW - ageMs, 'en', NOW)).toBe(expected);
  });

  it('renders Bengali numerals for the bn locale without any digit plumbing', () => {
    expect(formatRelativeAge(NOW - 5 * 60_000, 'bn', NOW)).toContain('৫');
  });

  it('clamps a server clock running ahead of the browser to "now"', () => {
    // Otherwise a badge whose entire job is to say how far in the past
    // something happened would read "in 3 seconds".
    expect(formatRelativeAge(NOW + 3_000, 'en', NOW)).toBe('now');
  });
});

describe('toIsoDate', () => {
  it('formats local calendar fields as YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(2024, 0, 5))).toBe('2024-01-05');
  });

  it('round-trips with parseDate', () => {
    expect(toIsoDate(parseDate('2024-01-05'))).toBe('2024-01-05');
  });

  it('pads years below 1000 to four digits', () => {
    const d = new Date(2000, 0, 1);
    d.setFullYear(999);
    expect(toIsoDate(d)).toBe('0999-01-01');
  });
});

describe('formatMonthName', () => {
  it('names the first and last month', () => {
    expect(formatMonthName(1, REGION_BD_EN)).toBe('January');
    expect(formatMonthName(1, REGION_BD_BN)).toBe('জানুয়ারি');
    expect(formatMonthName(12, REGION_BD_EN)).toBe('December');
    expect(formatMonthName(12, REGION_BD_BN)).toBe('ডিসেম্বর');
  });

  it('returns the none value for a non-integer or out-of-range month', () => {
    for (const m of [0, 13, 1.5, Number.NaN]) {
      expect(formatMonthName(m, REGION_BD_EN)).toBe('—');
    }
  });
});

describe('formatDateRange', () => {
  it('returns the none value when either date is invalid', () => {
    expect(formatDateRange(new Date(Number.NaN), new Date(2024, 0, 5), REGION_BD_EN)).toBe('—');
    expect(formatDateRange(new Date(2024, 0, 5), new Date(Number.NaN), REGION_BD_EN)).toBe('—');
  });

  it.each([
    ['2026-10-08', '2026-10-08', '8th October, 2026', '৮ই অক্টোবর, ২০২৬'],
    ['2026-10-08', '2026-10-10', '8th – 10th October', '৮ই – ১০ই অক্টোবর'],
    [
      '2026-09-28',
      '2026-10-03',
      '28th September – 3rd October, 2026',
      '২৮শে সেপ্টেম্বর – ৩রা অক্টোবর, ২০২৬',
    ],
    [
      '2026-12-30',
      '2027-01-02',
      '30th December, 2026 – 2nd January, 2027',
      '৩০শে ডিসেম্বর, ২০২৬ – ২রা জানুয়ারি, ২০২৭',
    ],
  ])('%s to %s', (from, to, en, bn) => {
    expect(formatDateRange(from, to, REGION_BD_EN)).toBe(en);
    expect(formatDateRange(from, to, REGION_BD_BN)).toBe(bn);
  });
});
