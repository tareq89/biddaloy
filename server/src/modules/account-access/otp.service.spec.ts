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
 * request()/verify() code path. Dispatches on `numkeys` (3 = the request
 * script, 4 = the verify script) since both are passed as raw strings.
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

      if (numkeys === 3) {
        const [otpKey, cooldownKey, dailyKey] = keys;
        const [record, , , cap] = args;
        const capped = Number(cap) > 0;
        if (capped && Number(store.get(dailyKey) ?? 0) >= Number(cap)) return 2;
        if (store.has(cooldownKey)) return 0;
        store.set(cooldownKey, '1');
        store.set(otpKey, record as string);
        if (capped) store.set(dailyKey, String(Number(store.get(dailyKey) ?? 0) + 1));
        return 1;
      }

      const [otpKey, cooldownKey, lockKey, attemptsKey] = keys;
      const [hash, maxAttempts] = args;
      if (store.has(lockKey)) return 'locked';
      const raw = store.get(otpKey);
      if (raw && (JSON.parse(raw) as { hash: string }).hash === hash) {
        store.delete(otpKey);
        store.delete(cooldownKey);
        store.delete(attemptsKey);
        return 'ok';
      }
      const attempts = Number(store.get(attemptsKey) ?? 0) + 1;
      store.set(attemptsKey, String(attempts));
      if (attempts >= Number(maxAttempts)) {
        store.set(lockKey, '1');
        store.delete(otpKey);
        store.delete(attemptsKey);
        return 'locked';
      }
      return raw ? 'invalid' : 'expired';
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

  it('locks an identifier that never had a code after the same 5 tries', async () => {
    for (let i = 0; i < 4; i++) {
      expect(await service.verify('LOGIN', 'nobody@test.com', '000000')).toBe('expired');
    }
    expect(await service.verify('LOGIN', 'nobody@test.com', '000000')).toBe('locked');
  });

  it('a code bound to one address fails when verified for another', async () => {
    const { code } = await service.request('LOGIN', 'user@test.com', 'old@test.com');
    expect(await service.verify('LOGIN', 'user@test.com', code, 'new@test.com')).toBe('invalid');
    expect(await service.verify('LOGIN', 'user@test.com', code, 'old@test.com')).toBe('ok');
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

  describe('daily cap per destination (GAP-05)', () => {
    const clearCooldowns = () => {
      for (const k of [...redis.store.keys()])
        if (k.startsWith('otp-cooldown:')) redis.store.delete(k);
    };
    const req = async (p: Parameters<OtpService['request']>[0], id: string) => {
      clearCooldowns();
      return service.request(p, id);
    };

    it('refuses the 11th code and writes no new code', async () => {
      for (let i = 0; i < 10; i++) await req('LOGIN', 'user@test.com');
      const before = redis.store.get('otp:LOGIN:user@test.com');
      await expect(req('LOGIN', 'user@test.com')).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(redis.store.get('otp:LOGIN:user@test.com')).toBe(before);
    });

    it('shares the count across purposes', async () => {
      for (let i = 0; i < 5; i++) await req('LOGIN', 'user@test.com');
      for (let i = 0; i < 5; i++) await req('PASSWORD_RESET', 'user@test.com');
      await expect(req('REGISTER', 'user@test.com')).rejects.toBeInstanceOf(
        TooManyRequestsException,
      );
    });

    it('counts every spelling of one phone number together', async () => {
      const forms = [
        '01712345678',
        '+880 1712-345678',
        '8801712345678',
        '+8801712345678',
        '00880 1712 345678',
      ];
      for (let i = 0; i < 10; i++) await req('REGISTER', forms[i % 5]);
      expect(redis.store.get('otp-daily:8801712345678')).toBe('10');
      await expect(req('REGISTER', '+880-1712-345678')).rejects.toBeInstanceOf(
        TooManyRequestsException,
      );
    });

    it('counts email casing and spaces together', async () => {
      for (let i = 0; i < 5; i++) await req('LOGIN', ' Foo@Test.com');
      for (let i = 0; i < 5; i++) await req('LOGIN', 'foo@test.com');
      await expect(req('LOGIN', 'foo@test.com')).rejects.toBeInstanceOf(TooManyRequestsException);
    });

    it('leaves other destinations alone', async () => {
      for (let i = 0; i < 10; i++) await req('LOGIN', 'a@test.com');
      await expect(req('LOGIN', 'b@test.com')).resolves.toBeDefined();
    });

    it('allows requests again once the daily key expires', async () => {
      for (let i = 0; i < 10; i++) await req('LOGIN', 'user@test.com');
      redis.store.delete('otp-daily:user@test.com');
      await expect(req('LOGIN', 'user@test.com')).resolves.toBeDefined();
    });

    it('does not count STEP_UP', async () => {
      for (let i = 0; i < 12; i++) await req('STEP_UP', 'tenant-1:user@test.com');
      expect([...redis.store.keys()].some((k) => k.startsWith('otp-daily:'))).toBe(false);
    });

    it('a correct verify does not reset the count', async () => {
      let last = { code: '' };
      for (let i = 0; i < 10; i++) last = await req('LOGIN', 'user@test.com');
      expect(await service.verify('LOGIN', 'user@test.com', last.code)).toBe('ok');
      await expect(req('LOGIN', 'user@test.com')).rejects.toBeInstanceOf(TooManyRequestsException);
    });

    it('checks the cap before the cooldown', async () => {
      for (let i = 0; i < 10; i++) await req('LOGIN', 'user@test.com');
      clearCooldowns();
      await expect(service.request('LOGIN', 'user@test.com')).rejects.toBeInstanceOf(
        TooManyRequestsException,
      );
      expect(redis.store.has('otp-cooldown:LOGIN:user@test.com')).toBe(false);
    });
  });
});
