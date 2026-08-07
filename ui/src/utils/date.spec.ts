import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '../i18n/region-config';

import { formatAcademicYear, formatDate, getAcademicYear, parseDate } from './date';

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
