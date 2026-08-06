import { describe, expect, it } from 'vitest';

import { formatCurrency, parseCurrency } from './currency';
import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from './region-config';

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
});
