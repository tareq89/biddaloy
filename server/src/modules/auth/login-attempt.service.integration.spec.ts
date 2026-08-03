import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import { LoginAttemptService } from './login-attempt.service';

/**
 * Integration tests for LoginAttemptService against a real Redis instance.
 *
 * Constructed with nodeEnv: 'production' explicitly — the ambient
 * NODE_ENV=test (set globally by test/setup.ts) is what the *unit* specs
 * verify bypasses lockout entirely; these tests need real enforcement, so
 * they override it the same way http-exception.filter.spec.ts overrides
 * AllExceptionsFilter's nodeEnv.
 */
describe('LoginAttemptService (integration)', () => {
  let redis: Redis;
  const threshold = 3;
  const windowMs = 5000;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });

  afterAll(async () => {
    redis.disconnect();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  function service(): LoginAttemptService {
    return new LoginAttemptService(redis, threshold, windowMs, 'production');
  }

  it('is not locked before any failures are recorded', async () => {
    expect(await service().isLocked('user@test.com')).toBe(false);
  });

  it('locks the identifier once the threshold is reached', async () => {
    const svc = service();

    for (let i = 0; i < threshold - 1; i++) {
      expect((await svc.recordFailure('user@test.com')).locked).toBe(false);
    }
    expect((await svc.recordFailure('user@test.com')).locked).toBe(true);
    expect(await svc.isLocked('user@test.com')).toBe(true);
  });

  it('does not lock a different identifier', async () => {
    const svc = service();

    for (let i = 0; i < threshold; i++) {
      await svc.recordFailure('user-a@test.com');
    }

    expect(await svc.isLocked('user-a@test.com')).toBe(true);
    expect(await svc.isLocked('user-b@test.com')).toBe(false);
  });

  it('clears the lock on reset', async () => {
    const svc = service();

    for (let i = 0; i < threshold; i++) {
      await svc.recordFailure('user@test.com');
    }
    expect(await svc.isLocked('user@test.com')).toBe(true);

    await svc.reset('user@test.com');

    expect(await svc.isLocked('user@test.com')).toBe(false);
  });

  it('unlocks automatically once the window expires', async () => {
    const shortWindowMs = 300;
    const svc = new LoginAttemptService(redis, threshold, shortWindowMs, 'production');

    for (let i = 0; i < threshold; i++) {
      await svc.recordFailure('user@test.com');
    }
    expect(await svc.isLocked('user@test.com')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 200));

    expect(await svc.isLocked('user@test.com')).toBe(false);
  }, 10000);

  it('shares lockout state across two service instances pointed at the same Redis', async () => {
    const instanceA = service();
    const instanceB = new LoginAttemptService(redis, threshold, windowMs, 'production');

    for (let i = 0; i < threshold; i++) {
      await instanceA.recordFailure('shared@test.com');
    }

    expect(await instanceB.isLocked('shared@test.com')).toBe(true);
  });
});
