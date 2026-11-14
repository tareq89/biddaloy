import { HttpException, HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import { COUPON_FAIL_LIMIT, COUPON_FAIL_WINDOW_MINUTES } from '@biddaloy/shared';

export interface CouponAttemptRedis {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

const KEY_PREFIX = 'coupon-fails:';
const WINDOW_MS = COUPON_FAIL_WINDOW_MINUTES * 60_000;

/** The answer for "too many wrong tries" (429). */
export function couponTryLater(): HttpException {
  return new HttpException(
    {
      message: 'Too many coupon tries. Please try again later.',
      details: { code: 'COUPON_TRY_LATER' },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * [Epic 100 D23, D29] Wrong-code tries per school: COUPON_FAIL_LIMIT in COUPON_FAIL_WINDOW_MINUTES,
 * then 429. A success does not reset the count. Preview and redeem both call `assertAllowed`
 * before and `recordFailure` after a refusal. Unlike the login limiter this FAILS CLOSED: with
 * Redis down `assertAllowed` throws 503 (Rule 15: the limit cannot be checked, so no try), so a coupon cannot be brute-forced during an outage.
 */
export class CouponAttemptLimiter {
  private readonly logger = new Logger(CouponAttemptLimiter.name);

  constructor(private readonly redis: CouponAttemptRedis) {}

  async assertAllowed(schoolId: string): Promise<void> {
    let count: number;
    try {
      count = Number((await this.redis.get(KEY_PREFIX + schoolId)) ?? 0);
    } catch (error) {
      this.logger.error(`Coupon limiter unavailable, failing closed: ${String(error)}`);
      throw new ServiceUnavailableException({
        message: 'Try again in a few minutes.',
        details: { code: 'COUPON_CHECK_UNAVAILABLE' },
      });
    }
    if (count >= COUPON_FAIL_LIMIT) throw couponTryLater();
  }

  /** Never throws: the refusal the caller is about to give is already the answer. */
  async recordFailure(schoolId: string): Promise<void> {
    const key = KEY_PREFIX + schoolId;
    try {
      if ((await this.redis.incr(key)) === 1) {
        try {
          await this.redis.pexpire(key, WINDOW_MS);
        } catch (e) {
          // A counter with no TTL would lock the school out for good.
          await this.redis.del(key).catch(() => undefined);
          throw e;
        }
      }
    } catch (error) {
      this.logger.error(`Coupon failure not recorded: ${String(error)}`);
    }
  }
}
