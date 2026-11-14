import { describe, it, expect } from 'vitest';
import { CouponDiscountKind } from '@biddaloy/shared';
import { computeCouponDiscount, type DiscountRule } from './coupon-discount';

const pct = (percent: number, extra: Partial<DiscountRule> = {}): DiscountRule => ({
  kind: CouponDiscountKind.PERCENT,
  percent,
  fixedPaisa: null,
  maxMonths: null,
  maxDiscountPaisa: null,
  minOrderPaisa: null,
  ...extra,
});
const fixed = (fixedPaisa: number, extra: Partial<DiscountRule> = {}): DiscountRule => ({
  kind: CouponDiscountKind.FIXED,
  percent: null,
  fixedPaisa,
  maxMonths: null,
  maxDiscountPaisa: null,
  minOrderPaisa: null,
  ...extra,
});

describe('computeCouponDiscount', () => {
  // 10 seats x 333 paisa = 3330 a month, 3 months, list total 9990.
  const order = { seats: 10, months: 3, unitPaisa: 333 };

  it.each([
    ['percent rounds down each month', pct(15), 499 * 3, 9990 - 499 * 3], // floor(3330*.15)=499
    ['fixed is taken off every month', fixed(100), 300, 9690],
    ['fixed is capped at the month base', fixed(5000), 9990, 0],
    ['max months limits the months discounted', pct(10, { maxMonths: 2 }), 333 * 2, 9990 - 666],
    [
      'max months above the order months changes nothing',
      pct(10, { maxMonths: 12 }),
      333 * 3,
      9990 - 999,
    ],
    ['max discount caps the total', pct(50, { maxDiscountPaisa: 1000 }), 1000, 8990],
    ['100 percent gives amount 0', pct(100), 9990, 0],
    ['minimum order met exactly still applies', pct(10, { minOrderPaisa: 9990 }), 999, 8991],
  ])('%s', (_n, rule, discountPaisa, amountPaisa) => {
    expect(computeCouponDiscount(rule, order)).toEqual({ discountPaisa, amountPaisa });
  });

  it('refuses (null) below the minimum order', () => {
    expect(computeCouponDiscount(pct(10, { minOrderPaisa: 9991 }), order)).toBeNull();
  });

  it('never goes below zero and always returns whole numbers', () => {
    const r = computeCouponDiscount(fixed(10_000_000), { seats: 1, months: 1, unitPaisa: 7 })!;
    expect(r).toEqual({ discountPaisa: 7, amountPaisa: 0 });
    for (const p of [1, 33, 99]) {
      const x = computeCouponDiscount(pct(p), { seats: 7, months: 5, unitPaisa: 101 })!;
      expect(Number.isInteger(x.discountPaisa) && Number.isInteger(x.amountPaisa)).toBe(true);
      expect(x.discountPaisa + x.amountPaisa).toBe(7 * 5 * 101);
    }
  });
});
