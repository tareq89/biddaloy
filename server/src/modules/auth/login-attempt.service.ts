import { Logger } from '@nestjs/common';

export interface LoginAttemptRedisClient {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  set(key: string, value: string, mode: 'PX', duration: number): Promise<'OK' | null>;
  exists(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

export interface LoginAttemptResult {
  locked: boolean;
  delayMs: number;
}

const ATTEMPTS_KEY_PREFIX = 'login-attempts:';
const LOCKOUT_KEY_PREFIX = 'login-lockout:';
const PROGRESSIVE_DELAY_STEP_MS = 500;
const MAX_PROGRESSIVE_DELAY_MS = 2000;

/**
 * Redis-backed per-identifier login attempt tracking: N failures within a
 * window lock the identifier out for that window, with a progressive delay
 * on the attempts leading up to it. Keyed by the identifier string alone
 * (see normalizeLoginIdentifier) — this applies identically whether or not
 * the identifier corresponds to a real account, so it can't be used to
 * enumerate which accounts exist.
 *
 * Fails open on Redis errors: Redis is already a hard dependency elsewhere
 * (BullMQ, rate limiting), so an outage is already an incident — losing
 * brute-force protection temporarily is preferable to locking every user
 * out of login entirely.
 */
export class LoginAttemptService {
  private readonly logger = new Logger(LoginAttemptService.name);

  private readonly enabled: boolean;

  constructor(
    private readonly redis: LoginAttemptRedisClient,
    private readonly threshold: number,
    private readonly windowMs: number,
    // The e2e suite logs in repeatedly against the same seeded admin
    // account; without this it would lock itself out mid-suite.
    nodeEnv: string | undefined = process.env.NODE_ENV,
  ) {
    this.enabled = nodeEnv !== 'test';
  }

  async isLocked(identifier: string): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const exists = await this.redis.exists(LOCKOUT_KEY_PREFIX + identifier);
      return exists === 1;
    } catch (error) {
      this.logFailure('isLocked', error);
      return false;
    }
  }

  /**
   * Records one failed attempt. Only call this when the identifier isn't
   * already locked (see AuthService.login) — once locked, further attempts
   * shouldn't keep extending the lockout window indefinitely.
   */
  async recordFailure(identifier: string): Promise<LoginAttemptResult> {
    if (!this.enabled) return { locked: false, delayMs: 0 };

    try {
      const attemptsKey = ATTEMPTS_KEY_PREFIX + identifier;
      const count = await this.redis.incr(attemptsKey);
      if (count === 1) {
        try {
          await this.redis.pexpire(attemptsKey, this.windowMs);
        } catch (expireError) {
          // incr already succeeded; without a TTL this key would never
          // expire and would silently accumulate toward a permanent
          // lockout — the opposite of this class's fail-open contract.
          // Drop it and let the outer catch apply the normal fail-open
          // response instead.
          await this.redis.del(attemptsKey).catch(() => undefined);
          throw expireError;
        }
      }

      const locked = count >= this.threshold;
      if (locked) {
        await this.redis.set(LOCKOUT_KEY_PREFIX + identifier, '1', 'PX', this.windowMs);
      }

      return { locked, delayMs: this.computeDelay(count) };
    } catch (error) {
      this.logFailure('recordFailure', error);
      return { locked: false, delayMs: 0 };
    }
  }

  async reset(identifier: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.redis.del(ATTEMPTS_KEY_PREFIX + identifier, LOCKOUT_KEY_PREFIX + identifier);
    } catch (error) {
      this.logFailure('reset', error);
    }
  }

  private computeDelay(attemptCount: number): number {
    return Math.min(
      Math.max(attemptCount - 1, 0) * PROGRESSIVE_DELAY_STEP_MS,
      MAX_PROGRESSIVE_DELAY_MS,
    );
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.error(
      `Login attempt tracking unavailable (${operation}), failing open: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
