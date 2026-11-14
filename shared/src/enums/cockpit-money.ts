/** [Epic 100] Cockpit money: SMS packages, stock, coupons. */
export enum SmsBundleOrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  ACTIVE = 'ACTIVE',
  USED_UP = 'USED_UP',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum SmsLotSource {
  BUNDLE = 'BUNDLE',
  MANUAL = 'MANUAL',
  LEGACY = 'LEGACY',
}

export enum SmsLotStatus {
  ACTIVE = 'ACTIVE',
  USED_UP = 'USED_UP',
  EXPIRED = 'EXPIRED',
  REFUNDED = 'REFUNDED',
}

export enum CouponDiscountKind {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export enum CouponScope {
  ALL = 'ALL',
  SCHOOLS = 'SCHOOLS',
}

export enum SmsSource {
  OWN = 'OWN',
  SCHOOLMANAGERP = 'SCHOOLMANAGERP',
}

export const ACTION_LINE_CODES = ['TOP_UP_NOW', 'SCHOOLS_LOW', 'SMS_EXPIRING', 'OVERSOLD'] as const;
export type ActionLineCode = (typeof ACTION_LINE_CODES)[number];

// Limits (Rule 5): bounds on every owner-typed number.
export const SMS_PACKAGE_MIN_SMS = 100;
export const SMS_PACKAGE_MAX_SMS = 1_000_000;
export const SMS_PACKAGE_MIN_DAYS = 1;
export const SMS_PACKAGE_MAX_DAYS = 365;
/** Input is upper-cased before the test (D23). */
export const COUPON_CODE_PATTERN = /^[A-Z0-9-]{4,20}$/;
export const COUPON_FAIL_LIMIT = 10;
export const COUPON_FAIL_WINDOW_MINUTES = 15;
export const SMS_STALE_BALANCE_DAYS = 7;
/** A school is "low" below the larger of the floor and the percent of its last top-up (D20). */
export const SMS_LOW_FLOOR = 100;
export const SMS_LOW_PERCENT = 10;
/** Expiry colours (D21). */
export const SMS_EXPIRY_AMBER_DAYS = 7;
export const SMS_EXPIRY_RED_DAYS = 1;
