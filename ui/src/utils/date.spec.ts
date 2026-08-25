import { afterEach, describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '../i18n/region-config';

import {
  formatAcademicYear,
  formatDate,
  formatDateTime,
  getAcademicYear,
  parseDate,
  parseServerDate,
} from './date';

const julyStart: RegionConfig = { ...REGION_BD_EN, academicYear: { startMonth: 7 } };
const julyStartBn: RegionConfig = { ...REGION_BD_BN, academicYear: { startMonth: 7 } };

describe('formatDate', () => {
  it('formats as YYYY-MM-DD with Latin digits', () => {
    expect(formatDate(new Date(2024, 0, 5), REGION_BD_EN)).toBe('2024-01-05');
  });

  it('renders Bengali digits for a Bengali-numeral config', () => {
    expect(formatDate(new Date(2024, 0, 5), REGION_BD_BN)).toBe('২০২৪-০১-০৫');
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

  it('round-trips through formatDate', () => {
    expect(formatDate(parseDate('2024-01-05'), REGION_BD_EN)).toBe('2024-01-05');
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

describe('formatDateTime', () => {
  // REGION_BD_* pin timezone: 'Asia/Dhaka' (UTC+6, no DST) — instants are
  // built in UTC so these assertions hold in any test-runner time zone.
  it('renders the instant on the tenant clock, zero-padded, 24h', () => {
    const date = new Date(Date.UTC(2026, 7, 25, 3, 5)); // 09:05 in Dhaka
    expect(formatDateTime(date, REGION_BD_EN)).toBe('2026-08-25 09:05');
  });

  it('renders time digits in the configured numeral system', () => {
    const date = new Date(Date.UTC(2026, 7, 25, 17, 50)); // 23:50 in Dhaka
    expect(formatDateTime(date, REGION_BD_BN)).toBe('২০২৬-০৮-২৫ ২৩:৫০');
  });

  it('keeps the tenant-local date across the UTC midnight boundary', () => {
    // 19:00 UTC on the 24th is already 01:00 on the 25th in Dhaka.
    const date = new Date(Date.UTC(2026, 7, 24, 19, 0));
    expect(formatDateTime(date, REGION_BD_EN)).toBe('2026-08-25 01:00');
  });
});
