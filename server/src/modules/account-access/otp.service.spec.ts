import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { OtpService, TooManyRequestsException } from './otp.service';

/** Map-backed fake with just enough ioredis surface for OtpService — same
 * style as login-attempt.service.spec.ts's `fakeRedis`, but stateful since
 * OtpService's own logic (attempt counting, cooldown) needs real
 * get/set/del semantics rather than pre-programmed return values. */
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
    redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.verify('LOGIN', 'user@test.com', '123456')).rejects.toMatchObject({
      status: 503,
    });

    redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.request('LOGIN', 'user2@test.com')).rejects.toMatchObject({ status: 503 });
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
