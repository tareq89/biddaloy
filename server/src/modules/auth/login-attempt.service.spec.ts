import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { LoginAttemptService } from './login-attempt.service';

function fakeRedis() {
  return {
    incr: vi.fn(),
    pexpire: vi.fn(),
    set: vi.fn(),
    exists: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  };
}

const THRESHOLD = 5;
const WINDOW_MS = 900_000;

describe('LoginAttemptService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("enabled (nodeEnv !== 'test')", () => {
    let redis: ReturnType<typeof fakeRedis>;
    let service: LoginAttemptService;

    beforeEach(() => {
      redis = fakeRedis();
      service = new LoginAttemptService(redis, THRESHOLD, WINDOW_MS, 'production');
    });

    describe('isLocked', () => {
      it('returns false when the lockout key does not exist', async () => {
        redis.exists.mockResolvedValue(0);

        expect(await service.isLocked('user@test.com')).toBe(false);
        expect(redis.exists).toHaveBeenCalledWith('login-lockout:user@test.com');
      });

      it('returns true when the lockout key exists', async () => {
        redis.exists.mockResolvedValue(1);

        expect(await service.isLocked('user@test.com')).toBe(true);
      });

      it('fails open (returns false) when Redis errors', async () => {
        vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        redis.exists.mockRejectedValue(new Error('ECONNREFUSED'));

        expect(await service.isLocked('user@test.com')).toBe(false);
      });
    });

    describe('recordFailure', () => {
      it('increments the attempts counter and sets its TTL on the first failure', async () => {
        redis.incr.mockResolvedValue(1);

        const result = await service.recordFailure('user@test.com');

        expect(redis.incr).toHaveBeenCalledWith('login-attempts:user@test.com');
        expect(redis.pexpire).toHaveBeenCalledWith('login-attempts:user@test.com', WINDOW_MS);
        expect(result).toEqual({ locked: false, delayMs: 0 });
      });

      it('does not reset the TTL on subsequent failures', async () => {
        redis.incr.mockResolvedValue(2);

        await service.recordFailure('user@test.com');

        expect(redis.pexpire).not.toHaveBeenCalled();
      });

      it('does not lock before the threshold is reached', async () => {
        redis.incr.mockResolvedValue(THRESHOLD - 1);

        const result = await service.recordFailure('user@test.com');

        expect(result.locked).toBe(false);
        expect(redis.set).not.toHaveBeenCalled();
      });

      it('locks once the threshold is reached', async () => {
        redis.incr.mockResolvedValue(THRESHOLD);

        const result = await service.recordFailure('user@test.com');

        expect(result.locked).toBe(true);
        expect(redis.set).toHaveBeenCalledWith('login-lockout:user@test.com', '1', 'PX', WINDOW_MS);
      });

      // Progressive delay ramps with attempt count, capped, so it blunts a
      // slow brute-force attempt without adding latency to a single typo.
      it('computes a progressive delay that ramps with attempt count and caps at 2000ms', async () => {
        redis.incr.mockResolvedValue(1);
        expect((await service.recordFailure('id')).delayMs).toBe(0);

        redis.incr.mockResolvedValue(2);
        expect((await service.recordFailure('id')).delayMs).toBe(500);

        redis.incr.mockResolvedValue(3);
        expect((await service.recordFailure('id')).delayMs).toBe(1000);

        redis.incr.mockResolvedValue(5);
        expect((await service.recordFailure('id')).delayMs).toBe(2000);

        redis.incr.mockResolvedValue(50);
        expect((await service.recordFailure('id')).delayMs).toBe(2000);
      });

      it('fails open (not locked, no delay) when Redis errors', async () => {
        vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        redis.incr.mockRejectedValue(new Error('ECONNREFUSED'));

        expect(await service.recordFailure('user@test.com')).toEqual({ locked: false, delayMs: 0 });
      });

      // incr and pexpire aren't atomic. If incr succeeds but pexpire then
      // fails, a naive implementation leaves a counter with no TTL — it
      // never expires, so every later failure keeps incrementing it past
      // the threshold and the identifier stays locked forever. That's the
      // opposite of this class's fail-open contract, so the key must be
      // deleted instead of left behind.
      it('deletes the attempts key and fails open when pexpire fails after a successful incr', async () => {
        vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        redis.incr.mockResolvedValue(1);
        redis.pexpire.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await service.recordFailure('user@test.com');

        expect(result).toEqual({ locked: false, delayMs: 0 });
        expect(redis.del).toHaveBeenCalledWith('login-attempts:user@test.com');
        expect(redis.set).not.toHaveBeenCalled();
      });
    });

    describe('reset', () => {
      it('deletes both the attempts and lockout keys', async () => {
        await service.reset('user@test.com');

        expect(redis.del).toHaveBeenCalledWith(
          'login-attempts:user@test.com',
          'login-lockout:user@test.com',
        );
      });

      it('fails open silently when Redis errors', async () => {
        vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        redis.del.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(service.reset('user@test.com')).resolves.toBeUndefined();
      });
    });
  });

  // The e2e suite logs in repeatedly against the same seeded admin account;
  // without this bypass it would lock itself out mid-suite.
  describe('disabled under NODE_ENV=test', () => {
    let redis: ReturnType<typeof fakeRedis>;
    let service: LoginAttemptService;

    beforeEach(() => {
      redis = fakeRedis();
      service = new LoginAttemptService(redis, THRESHOLD, WINDOW_MS, 'test');
    });

    it('isLocked always returns false without touching Redis', async () => {
      expect(await service.isLocked('user@test.com')).toBe(false);
      expect(redis.exists).not.toHaveBeenCalled();
    });

    it('recordFailure is a no-op that never locks', async () => {
      expect(await service.recordFailure('user@test.com')).toEqual({ locked: false, delayMs: 0 });
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('reset is a no-op', async () => {
      await service.reset('user@test.com');
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  it('defaults nodeEnv from process.env.NODE_ENV when not passed', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    try {
      const redis = fakeRedis();
      const service = new LoginAttemptService(redis, THRESHOLD, WINDOW_MS);

      expect(await service.isLocked('user@test.com')).toBe(false);
      expect(redis.exists).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
