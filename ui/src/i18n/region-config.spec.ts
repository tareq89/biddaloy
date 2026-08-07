import { describe, expect, it } from 'vitest';

import { formatCurrency, parseCurrency } from '../utils/currency';
import { formatDate, formatAcademicYear } from '../utils/date';
import { formatPhone, parsePhone } from '../utils/phone';

import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from './region-config';

describe('REGION_BD_BN / REGION_BD_EN', () => {
  it('bn-BD uses Bengali numerals, lakh-crore grouping, and a ৳ prefix', () => {
    expect(REGION_BD_BN.locale).toBe('bn-BD');
    expect(REGION_BD_BN.numerals).toBe('bengali');
    expect(REGION_BD_BN.currency.grouping).toBe('lakh-crore');
    expect(REGION_BD_BN.currency.symbol).toBe('৳');
    expect(REGION_BD_BN.currency.position).toBe('prefix');
  });

  it('en-BD shares every regional rule with bn-BD, swapped for Latin numerals', () => {
    expect(REGION_BD_EN.locale).toBe('en-BD');
    expect(REGION_BD_EN.numerals).toBe('latin');
    expect(REGION_BD_EN.currency).toEqual(REGION_BD_BN.currency);
    expect(REGION_BD_EN.phone).toEqual(REGION_BD_BN.phone);
    expect(REGION_BD_EN.date).toEqual(REGION_BD_BN.date);
    expect(REGION_BD_EN.address).toEqual(REGION_BD_BN.address);
    expect(REGION_BD_EN.identifiers).toEqual(REGION_BD_BN.identifiers);
    expect(REGION_BD_EN.timezone).toBe(REGION_BD_BN.timezone);
  });

  it('covers currency, numerals, date, phone, address, academic year, identifiers and timezone', () => {
    const fields: (keyof RegionConfig)[] = [
      'locale',
      'currency',
      'numerals',
      'date',
      'phone',
      'address',
      'academicYear',
      'identifiers',
      'timezone',
    ];
    for (const field of fields) {
      expect(REGION_BD_BN[field]).not.toBeUndefined();
    }
  });

  it('the academic-year start month is configurable, not hardcoded to January', () => {
    const julyStart: RegionConfig = { ...REGION_BD_EN, academicYear: { startMonth: 7 } };

    expect(formatAcademicYear(new Date(2024, 0, 15), julyStart)).toBe('2023–2024');
  });
});

/**
 * A hypothetical second region — not a country biddaloy actually ships,
 * deliberately: nothing here should suggest this is a real target, only
 * that the shape holds for something that isn't Bangladesh. Comma-group
 * thousands, a suffix currency symbol, a different phone plan, Monday as
 * the first day of the week — every axis `REGION_BD_BN`/`REGION_BD_EN`
 * happen to agree on, deliberately made to disagree here.
 */
const REGION_FIXTURE: RegionConfig = {
  locale: 'en-FX',
  currency: { code: 'FXC', symbol: 'Fx', position: 'suffix', decimals: 2, grouping: 'thousand' },
  numerals: 'latin',
  date: { format: 'YYYY-MM-DD', firstDayOfWeek: 1, calendar: 'gregory' },
  phone: { country: '99', pattern: /^5\d{6}$/, example: '5123456', displayFormat: 'XXX-XXXX' },
  address: { fields: ['street', 'city', 'postal_code'], order: ['street', 'city', 'postal_code'] },
  academicYear: { startMonth: 9 },
  identifiers: { national: '^[A-Z]{2}[0-9]{6}$', student: '' },
  timezone: 'Etc/UTC',
};

describe('a second region — proves adding a country is one config object, zero component changes', () => {
  it('formatCurrency uses the fixture symbol as a suffix with thousand grouping', () => {
    expect(formatCurrency(123456789, REGION_FIXTURE)).toBe('1,234,567.89Fx');
  });

  it('parseCurrency round-trips against the fixture', () => {
    expect(parseCurrency('1,234,567.89Fx', REGION_FIXTURE)).toBe(123456789);
  });

  it('formatDate ignores currency/phone entirely and still renders correctly', () => {
    expect(formatDate(new Date(2024, 0, 5), REGION_FIXTURE)).toBe('2024-01-05');
  });

  it('formatAcademicYear straddles the calendar year for a September start', () => {
    expect(formatAcademicYear(new Date(2024, 0, 15), REGION_FIXTURE)).toBe('2023–2024');
  });

  it('parsePhone validates against the fixture pattern, not BD’s', () => {
    expect(parsePhone('5123456', REGION_FIXTURE)).toEqual({ valid: true, value: '5123456' });
    expect(parsePhone('1712345678', REGION_FIXTURE).valid).toBe(false);
  });

  it('formatPhone applies the fixture displayFormat mask, not BD’s', () => {
    expect(formatPhone('5123456', REGION_FIXTURE)).toBe('+99 512-3456');
  });
});
