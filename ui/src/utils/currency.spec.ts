import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '../i18n/region-config';

import {
  formatCurrency,
  formatServerAmount,
  minorUnitsToDecimalString,
  parseCurrency,
  serverAmountToMinorUnits,
} from './currency';

describe('formatCurrency', () => {
  it("matches the issue's own example digit grouping — ৳1,23,456 in minor units (paisa), so the decimals show", () => {
    // The issue's literal example passes 123456 as if it were taka with no
    // decimals; this file's header comment explains why that can't be the
    // real API (it reintroduces float risk) — 12345600 paisa is the same
    // amount, and produces the same grouping the example is checking for.
    expect(formatCurrency(12345600, REGION_BD_BN)).toBe('৳১,২৩,৪৫৬.০০');
    expect(formatCurrency(12345600, REGION_BD_EN)).toBe('৳1,23,456.00');
  });

  it.each([
    [100, '৳1.00'],
    [99999, '৳999.99'],
    [999999, '৳9,999.99'],
    [99999999, '৳9,99,999.99'],
    [9999999999, '৳9,99,99,999.99'],
  ])('groups %i paisa as %s across digit-count boundaries', (minorUnits, expected) => {
    expect(formatCurrency(minorUnits, REGION_BD_EN)).toBe(expected);
  });

  it('renders zero without a sign', () => {
    expect(formatCurrency(0, REGION_BD_EN)).toBe('৳0.00');
  });

  it('prefixes a negative amount with a minus sign, before the currency symbol', () => {
    expect(formatCurrency(-12345600, REGION_BD_EN)).toBe('-৳1,23,456.00');
  });

  it('respects suffix currency position', () => {
    const suffixConfig: RegionConfig = {
      ...REGION_BD_EN,
      currency: { ...REGION_BD_EN.currency, position: 'suffix' },
    };
    expect(formatCurrency(12345600, suffixConfig)).toBe('1,23,456.00৳');
  });

  it('supports zero-decimal currencies', () => {
    const zeroDecimalConfig: RegionConfig = {
      ...REGION_BD_EN,
      currency: { ...REGION_BD_EN.currency, decimals: 0 },
    };
    expect(formatCurrency(123456, zeroDecimalConfig)).toBe('৳1,23,456');
  });

  it('rejects a non-integer amount rather than silently truncating', () => {
    expect(() => formatCurrency(100.5, REGION_BD_EN)).toThrow(RangeError);
  });

  it('rejects an amount past Number.MAX_SAFE_INTEGER rather than formatting a rounded value', () => {
    // Number.isInteger(Number.MAX_SAFE_INTEGER + 2) is true — IEEE 754
    // rounds it to an even integer — so this specifically needs
    // Number.isSafeInteger, not Number.isInteger, to catch it.
    expect(() => formatCurrency(Number.MAX_SAFE_INTEGER + 2, REGION_BD_EN)).toThrow(RangeError);
  });
});

describe('parseCurrency', () => {
  it.each([
    ['৳1,23,456.00', 12345600],
    ['1,23,456.00', 12345600],
    ['123456.00', 12345600],
    ['-৳1,23,456.00', -12345600],
    ['0.00', 0],
  ])('parses %s (Latin digits) as %i paisa', (input, expected) => {
    expect(parseCurrency(input, REGION_BD_EN)).toBe(expected);
  });

  it('accepts Bengali digits', () => {
    expect(parseCurrency('৳১,২৩,৪৫৬.০০', REGION_BD_BN)).toBe(12345600);
  });

  it('round-trips through formatCurrency for a range of amounts', () => {
    for (const amount of [0, 1, 100, 99999, 999999, 12345600, 9999999999]) {
      expect(parseCurrency(formatCurrency(amount, REGION_BD_EN), REGION_BD_EN)).toBe(amount);
      expect(parseCurrency(formatCurrency(amount, REGION_BD_BN), REGION_BD_BN)).toBe(amount);
    }
  });

  it('throws on garbage input rather than returning NaN', () => {
    expect(() => parseCurrency('not a number', REGION_BD_EN)).toThrow(RangeError);
  });

  it('throws when more decimal places are given than the currency supports', () => {
    expect(() => parseCurrency('100.999', REGION_BD_EN)).toThrow(RangeError);
  });

  it('throws on an amount past Number.MAX_SAFE_INTEGER rather than silently losing precision', () => {
    // Two inputs one paisa apart, both past the safe-integer boundary,
    // would `Number(...)` to the *same* double if this went through
    // `Number(...)` directly — this is the failure mode `bigint` parsing
    // avoids, verified by asserting both are rejected rather than by
    // comparing them (RangeError means neither ever became a Number to
    // compare).
    expect(() => parseCurrency('123456789012345678.00', REGION_BD_EN)).toThrow(RangeError);
    expect(() => parseCurrency('123456789012345679.00', REGION_BD_EN)).toThrow(RangeError);
  });

  it('parses an amount right at Number.MAX_SAFE_INTEGER exactly', () => {
    expect(parseCurrency('90071992547409.91', REGION_BD_EN)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('formatServerAmount', () => {
  it('formats a decimal-column string amount unchanged', () => {
    expect(formatServerAmount('1234.56', REGION_BD_EN)).toBe('৳1,234.56');
  });

  it('formats a plain server-summed number', () => {
    expect(formatServerAmount(1234.56, REGION_BD_EN)).toBe('৳1,234.56');
  });

  it('absorbs float artifacts past the currency precision instead of throwing', () => {
    // SUM(...) style server arithmetic can produce e.g. 2000.0000000000002 —
    // more fractional digits than BDT's configured 2 decimals, which
    // parseCurrency would otherwise reject outright.
    expect(formatServerAmount(2000.0000000000002, REGION_BD_EN)).toBe('৳2,000.00');
  });

  it('rounds to the currency-configured decimal places', () => {
    expect(formatServerAmount(1234.565, REGION_BD_EN)).toBe('৳1,234.57');
  });

  it('rounds a half-cent value up instead of truncating it', () => {
    // The closest double to 1.005 is actually 1.00499999999999989... —
    // `(1.005).toFixed(2)` rounds that binary value down to "1.00".
    // formatServerAmount must round the decimal value itself, not that
    // binary artifact, so a genuine half-cent rounds up like a human
    // reading "1.005" would expect.
    expect(formatServerAmount(1.005, REGION_BD_EN)).toBe('৳1.01');
  });

  it('falls back to toFixed for a magnitude that toString() itself renders in exponential notation', () => {
    // 0.0000001 is small enough that `(0.0000001).toString()` is "1e-7",
    // not a plain decimal string — there's no digit string to round by
    // hand at that point, so this goes through the toFixed fallback.
    expect(formatServerAmount(0.0000001, REGION_BD_EN)).toBe('৳0.00');
  });

  it('rounds a negative half-cent value away from zero', () => {
    expect(formatServerAmount(-1.005, REGION_BD_EN)).toBe('-৳1.01');
  });

  it('rounds a zero-decimal currency amount to a whole number', () => {
    const zeroDecimalConfig: RegionConfig = {
      ...REGION_BD_EN,
      currency: { ...REGION_BD_EN.currency, decimals: 0 },
    };
    expect(formatServerAmount(1234.5, zeroDecimalConfig)).toBe('৳1,235');
  });
});

describe('serverAmountToMinorUnits', () => {
  it('converts a decimal-column string amount to minor units', () => {
    expect(serverAmountToMinorUnits('1234.56', REGION_BD_EN)).toBe(123456);
  });

  it('rounds a server-summed float amount before converting', () => {
    expect(serverAmountToMinorUnits(2000.0000000000002, REGION_BD_EN)).toBe(200000);
  });

  it('rounds a half-cent value up instead of truncating it', () => {
    expect(serverAmountToMinorUnits(1.005, REGION_BD_EN)).toBe(101);
  });
});

describe('minorUnitsToDecimalString', () => {
  it.each([
    [123456, '1234.56'],
    [100, '1.00'],
    [1, '0.01'],
    [0, '0.00'],
    [-123456, '-1234.56'],
  ])('converts %i minor units to %s', (minorUnits, expected) => {
    expect(minorUnitsToDecimalString(minorUnits, REGION_BD_EN)).toBe(expected);
  });

  it('omits the decimal point for a zero-decimal currency', () => {
    const zeroDecimalConfig: RegionConfig = {
      ...REGION_BD_EN,
      currency: { ...REGION_BD_EN.currency, decimals: 0 },
    };
    expect(minorUnitsToDecimalString(1234, zeroDecimalConfig)).toBe('1234');
  });

  it('round-trips through serverAmountToMinorUnits for a range of amounts', () => {
    for (const minorUnits of [0, 1, 100, 99999, 999999, 12345600, 9999999999]) {
      const decimalString = minorUnitsToDecimalString(minorUnits, REGION_BD_EN);
      expect(serverAmountToMinorUnits(decimalString, REGION_BD_EN)).toBe(minorUnits);
    }
  });
});
