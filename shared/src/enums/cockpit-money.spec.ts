import { describe, expect, it } from 'vitest';

import * as m from './cockpit-money';

describe('cockpit money enums and limits [#3850]', () => {
  it('pins every value list', () => {
    expect(Object.values(m.SmsBundleOrderStatus)).toEqual([
      'PENDING_PAYMENT',
      'PAID',
      'ACTIVE',
      'USED_UP',
      'EXPIRED',
      'CANCELLED',
      'REFUNDED',
    ]);
    expect(Object.values(m.SmsLotSource)).toEqual(['BUNDLE', 'MANUAL', 'LEGACY']);
    expect(Object.values(m.SmsLotStatus)).toEqual(['ACTIVE', 'USED_UP', 'EXPIRED', 'REFUNDED']);
    expect(Object.values(m.CouponDiscountKind)).toEqual(['PERCENT', 'FIXED']);
    expect(Object.values(m.CouponScope)).toEqual(['ALL', 'SCHOOLS']);
    expect(Object.values(m.SmsSource)).toEqual(['OWN', 'SCHOOLMANAGERP']);
    expect([...m.ACTION_LINE_CODES]).toEqual([
      'TOP_UP_NOW',
      'SCHOOLS_LOW',
      'SMS_EXPIRING',
      'OVERSOLD',
    ]);
  });

  it('pins every limit', () => {
    expect([
      m.SMS_PACKAGE_MIN_SMS,
      m.SMS_PACKAGE_MAX_SMS,
      m.SMS_PACKAGE_MIN_DAYS,
      m.SMS_PACKAGE_MAX_DAYS,
      m.COUPON_FAIL_LIMIT,
      m.COUPON_FAIL_WINDOW_MINUTES,
      m.SMS_STALE_BALANCE_DAYS,
      m.SMS_LOW_FLOOR,
      m.SMS_LOW_PERCENT,
      m.SMS_EXPIRY_AMBER_DAYS,
      m.SMS_EXPIRY_RED_DAYS,
    ]).toEqual([100, 1_000_000, 1, 365, 10, 15, 7, 100, 10, 7, 1]);
  });

  it('coupon code pattern is 4-20 of A-Z 0-9 -', () => {
    for (const ok of ['ABCD', 'EID-2027', 'A'.repeat(20)])
      expect(m.COUPON_CODE_PATTERN.test(ok)).toBe(true);
    for (const bad of ['ABC', 'A'.repeat(21), 'abcd', 'AB CD', 'AB_CD'])
      expect(m.COUPON_CODE_PATTERN.test(bad)).toBe(false);
  });
});
