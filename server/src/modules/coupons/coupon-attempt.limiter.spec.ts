import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { COUPON_FAIL_LIMIT } from '@biddaloy/shared';
import { CouponAttemptLimiter, type CouponAttemptRedis } from './coupon-attempt.limiter';

function fakeRedis(opts: { down?: boolean } = {}) {
  const counts = new Map<string, number>();
  const ttls: Record<string, number> = {};
  const redis: CouponAttemptRedis = {
    get: async (k) => {
      if (opts.down) throw new Error('down');
      return counts.has(k) ? String(counts.get(k)) : null;
    },
    incr: async (k) => {
      if (opts.down) throw new Error('down');
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    },
    pexpire: async (k, ms) => {
      ttls[k] = ms;
      return 1;
    },
    del: async (...ks) => {
      ks.forEach((k) => counts.delete(k));
      return ks.length;
    },
  };
  return { redis, ttls };
}

async function fail(l: CouponAttemptLimiter, school: string, n: number) {
  for (let i = 0; i < n; i++) await l.recordFailure(school);
}

describe('CouponAttemptLimiter', () => {
  it('allows at 9 failures and at 10 failures minus one', async () => {
    const l = new CouponAttemptLimiter(fakeRedis().redis);
    await fail(l, 's1', COUPON_FAIL_LIMIT - 1);
    await expect(l.assertAllowed('s1')).resolves.toBeUndefined();
  });

  it('refuses from the 10th failure on with 429 COUPON_TRY_LATER', async () => {
    const l = new CouponAttemptLimiter(fakeRedis().redis);
    await fail(l, 's1', COUPON_FAIL_LIMIT);
    const err = await l.assertAllowed('s1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse().details.code).toBe('COUPON_TRY_LATER');
    // 11th try is refused the same way.
    await fail(l, 's1', 1);
    await expect(l.assertAllowed('s1')).rejects.toBeInstanceOf(HttpException);
  });

  it('counts per school: another school is untouched', async () => {
    const l = new CouponAttemptLimiter(fakeRedis().redis);
    await fail(l, 's1', COUPON_FAIL_LIMIT);
    await expect(l.assertAllowed('s2')).resolves.toBeUndefined();
  });

  it('sets the 15 minute window on the first failure only', async () => {
    const { redis, ttls } = fakeRedis();
    const l = new CouponAttemptLimiter(redis);
    await fail(l, 's1', 1);
    expect(ttls['coupon-fails:s1']).toBe(15 * 60_000);
  });

  it('fails closed with the same 429 when Redis is down', async () => {
    const l = new CouponAttemptLimiter(fakeRedis({ down: true }).redis);
    const err = await l.assertAllowed('s1').catch((e) => e);
    expect(err.getStatus()).toBe(429);
    // recording never throws
    await expect(l.recordFailure('s1')).resolves.toBeUndefined();
  });
});
