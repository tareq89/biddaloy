import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OtpService, TooManyRequestsException } from './otp.service';

/** Map-backed fake with just enough ioredis surface for OtpService — same
 * style as login-attempt.service.spec.ts's `fakeRedis`, but stateful since
 * OtpService's own logic (attempt counting, cooldown) needs real
 * get/set/del semantics rather than pre-programmed return values.
 *
 * `eval` re-implements the two Lua scripts in JS against the same `store`
 * Map — OtpService now does its atomic request/verify sequences as a
 * single `EVAL` rather than separate get/set/del calls, so a fake that
 * only stubbed those individually could no longer exercise the real
 * request()/verify() code path. Dispatches on `numkeys` (2 = the request
 * script, 3 = the verify script) since both are passed as raw strings.
 */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    pttl: vi.fn(async (key: string) => (store.has(key) ? 60_000 : -2)),
    eval: vi.fn(async (_script: string, numkeys: number, ...rest: (string | number)[]) => {
      const keys = rest.slice(0, numkeys) as string[];
      const args = rest.slice(numkeys);

      if (numkeys === 2) {
        const [otpKey, cooldownKey] = keys;
        const [record, codeTtl] = args;
        if (store.has(cooldownKey)) return 0;
        store.set(cooldownKey, '1');
        store.set(otpKey, record as string);
        void codeTtl;
        return 1;
      }

      const [otpKey, cooldownKey, lockKey] = keys;
      const [hash, maxAttempts] = args;
      if (store.has(lockKey)) return 'locked';
      const raw = store.get(otpKey);
      if (!raw) return 'expired';
      const record = JSON.parse(raw) as { hash: string; attempts: number };
      if (record.hash === hash) {
        store.delete(otpKey);
        store.delete(cooldownKey);
        return 'ok';
      }
      const attempts = record.attempts + 1;
      if (attempts >= Number(maxAttempts)) {
        store.set(lockKey, '1');
        store.delete(otpKey);
        return 'locked';
      }
      store.set(otpKey, JSON.stringify({ hash: record.hash, attempts }));
      return 'invalid';
    }),
  };
}

describe('OtpService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let service: OtpService;

  beforeEach(() => {
    redis = fakeRedis();
    service = new OtpService(redis as unknown as import('ioredis').default);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a 6-digit code', async () => {
    const { code } = await service.request('LOGIN', 'user@test.com');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('verifies the correct code as ok', async () => {
    const { code } = await service.request('LOGIN', 'user@test.com');
    expect(await service.verify('LOGIN', 'user@test.com', code)).toBe('ok');
  });

  it('accepts Bengali-numeral input for the same code', async () => {
    const { code } = await service.request('LOGIN', 'user@test.com');
    const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    const bengaliCode = code.replace(/[0-9]/g, (d) => bengaliDigits[Number(d)]);
    expect(await service.verify('LOGIN', 'user@test.com', bengaliCode)).toBe('ok');
  });

  it('returns expired when no code was ever requested', async () => {
    expect(await service.verify('LOGIN', 'nobody@test.com', '123456')).toBe('expired');
  });

  it('returns invalid for a wrong code, without discarding the real one', async () => {
    const { code } = await service.request('LOGIN', 'user@test.com');
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await service.verify('LOGIN', 'user@test.com', wrong)).toBe('invalid');
    expect(await service.verify('LOGIN', 'user@test.com', code)).toBe('ok');
  });

  it('locks after 5 wrong attempts', async () => {
    const { code } = await service.request('LOGIN', 'user@test.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      expect(await service.verify('LOGIN', 'user@test.com', wrong)).toBe('invalid');
    }
    expect(await service.verify('LOGIN', 'user@test.com', wrong)).toBe('locked');
    // Even the correct code is rejected once locked.
    expect(await service.verify('LOGIN', 'user@test.com', code)).toBe('locked');
  });

  it('rejects a second request within the cooldown window with 429', async () => {
    await service.request('LOGIN', 'user@test.com');
    await expect(service.request('LOGIN', 'user@test.com')).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
  });

  it('maps a Redis failure to a 503, on both request and verify', async () => {
    redis.eval.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.verify('LOGIN', 'user@test.com', '123456')).rejects.toMatchObject({
      status: 503,
    });

    redis.eval.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.request('LOGIN', 'user2@test.com')).rejects.toMatchObject({ status: 503 });
  });

  it('only one of two concurrent requests wins the cooldown race', async () => {
    const results = await Promise.allSettled([
      service.request('LOGIN', 'racer@test.com'),
      service.request('LOGIN', 'racer@test.com'),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof TooManyRequestsException,
    ).length;
    expect(succeeded).toBe(1);
    expect(rejected).toBe(1);
  });

  it('never logs the plain code', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const { code } = await service.request('LOGIN', 'user@test.com');
    await service.verify('LOGIN', 'user@test.com', code);

    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(code);
      }
    }
  });
});
