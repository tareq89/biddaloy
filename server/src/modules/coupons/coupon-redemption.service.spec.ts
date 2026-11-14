import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import { CouponDiscountKind, CouponScope } from '@biddaloy/shared';
import { CouponRedemptionService, normaliseCouponCode } from './coupon-redemption.service';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);
const coupon = (over: object = {}) => ({
  id: 'c1',
  discount_kind: CouponDiscountKind.PERCENT,
  percent: 10,
  fixed_paisa: null,
  max_months: null,
  max_discount_paisa: null,
  min_order_paisa: null,
  scope: CouponScope.ALL,
  per_school_max: 1,
  active: true,
  starts_at: past,
  ends_at: future,
  max_uses: null,
  uses_count: 0,
  ...over,
});
const INPUT = { schoolId: 's1', code: ' welcome10 ', seats: 10, months: 1, unitPaisa: 1000 };

/** A manager that answers by the SQL it is given. */
function manager(opts: {
  coupon?: object | null;
  updated?: boolean;
  used?: number;
  inSchools?: boolean;
}) {
  const q = vi.fn(async (sql: string) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.startsWith('SELECT id, discount_kind'))
      return opts.coupon === null ? [] : [coupon(opts.coupon)];
    if (sql.startsWith('UPDATE coupons'))
      return opts.updated === false ? [[], 0] : [[{ id: 'c1' }], 1];
    if (sql.includes('count(*)')) return [{ n: String(opts.used ?? 0) }];
    if (sql.includes('FROM coupon_schools')) return opts.inSchools ? [{}] : [];
    return [];
  });
  return { query: q } as any;
}

function build(m: any, limiter = { assertAllowed: vi.fn(), recordFailure: vi.fn() }) {
  const audit = { record: vi.fn() };
  const svc = new CouponRedemptionService({ manager: m } as any, limiter as any, audit as any);
  return { svc, limiter, audit };
}

const NOT_VALID = {
  message: 'This coupon code is not valid.',
  details: { code: 'COUPON_NOT_VALID' },
};

describe('normaliseCouponCode', () => {
  it('trims and upper-cases; rejects bad shapes', () => {
    expect(normaliseCouponCode('  ab-12 ')).toBe('AB-12');
    expect(normaliseCouponCode('abc')).toBeNull();
    expect(normaliseCouponCode('has space1')).toBeNull();
    expect(normaliseCouponCode('A'.repeat(21))).toBeNull();
  });
});

describe('CouponRedemptionService.preview', () => {
  it('prices a valid coupon with no write', async () => {
    const m = manager({});
    const { svc } = build(m);
    expect(await svc.preview(INPUT)).toEqual({
      couponId: 'c1',
      discountPaisa: 1000,
      amountPaisa: 9000,
    });
    expect(m.query.mock.calls.some(([s]: [string]) => /UPDATE|INSERT/.test(s))).toBe(false);
  });

  it.each([
    ['unknown code', { coupon: null }],
    ['expired', { coupon: { ends_at: past } }],
    ['inactive', { coupon: { active: false } }],
    ['used up', { coupon: { max_uses: 2, uses_count: 2 } }],
    ['school cap reached', { used: 1 }],
    ['wrong school', { coupon: { scope: CouponScope.SCHOOLS }, inSchools: false }],
    ['below the minimum', { coupon: { min_order_paisa: '10001' } }],
  ])('%s gives the one generic 400 and counts as a wrong try', async (_n, opts) => {
    const { svc, limiter } = build(manager(opts));
    const err = await svc.preview(INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toEqual(NOT_VALID);
    expect(limiter.recordFailure).toHaveBeenCalledWith('s1');
  });

  it('a malformed code is the same sentence', async () => {
    const { svc } = build(manager({}));
    const err = await svc.preview({ ...INPUT, code: '!!' }).catch((e) => e);
    expect(err.getResponse()).toEqual(NOT_VALID);
  });

  it('a limited school is refused before any lookup', async () => {
    const m = manager({});
    const limiter = {
      assertAllowed: vi.fn().mockRejectedValue(new HttpException('later', 429)),
      recordFailure: vi.fn(),
    };
    const { svc } = build(m, limiter);
    await expect(svc.preview(INPUT)).rejects.toBeInstanceOf(HttpException);
    expect(m.query).not.toHaveBeenCalled();
  });
});

describe('CouponRedemptionService.redeemInTx', () => {
  const redeem = { ...INPUT, seatOrderId: 'o1', discountPaisa: 1000 };

  it('locks, takes the use, inserts the redemption and audits', async () => {
    const m = manager({});
    const { svc, audit } = build(manager({}));
    const res = await svc.redeemInTx(m, redeem);
    expect(res.discountPaisa).toBe(1000);
    const sqls = m.query.mock.calls.map(([s]: [string]) => s);
    expect(sqls[0]).toContain('pg_advisory_xact_lock');
    expect(sqls.some((s: string) => s.startsWith('UPDATE coupons'))).toBe(true);
    expect(sqls.some((s: string) => s.includes('INSERT INTO coupon_redemptions'))).toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('a lost race (UPDATE touched no row) is the generic refusal and inserts nothing', async () => {
    const m = manager({ updated: false });
    const { svc } = build(m);
    const err = await svc.redeemInTx(m, redeem).catch((e) => e);
    expect(err.getResponse()).toEqual(NOT_VALID);
    expect(
      m.query.mock.calls.some(([s]: [string]) => s.includes('INSERT INTO coupon_redemptions')),
    ).toBe(false);
  });

  it('a discount that differs from the engine result is a bug, not a user error', async () => {
    const m = manager({});
    const { svc } = build(m);
    await expect(svc.redeemInTx(m, { ...redeem, discountPaisa: 999 })).rejects.toThrow(
      /does not match/,
    );
  });
});
