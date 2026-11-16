import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { OtpSmsCapsService } from './otp-sms-caps.service';

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));

/** In-memory stand-in for the few Redis commands the caps use; records every argument. */
function fakeRedis() {
  const sets = new Map<string, Set<string>>();
  const counters = new Map<string, number>();
  const strings = new Map<string, string>();
  const args: unknown[][] = [];
  const log = (...a: unknown[]) => args.push(a);
  const redis = {
    multi: () => {
      const ops: Array<() => unknown> = [];
      const chain: any = {
        sadd: (k: string, m: string) => (
          log('sadd', k, m),
          ops.push(() => {
            const s = sets.get(k) ?? new Set();
            s.add(m);
            sets.set(k, s);
            return 1;
          }),
          chain
        ),
        scard: (k: string) => (log('scard', k), ops.push(() => sets.get(k)?.size ?? 0), chain),
        incr: (k: string) => (
          log('incr', k),
          ops.push(() => {
            counters.set(k, (counters.get(k) ?? 0) + 1);
            return counters.get(k);
          }),
          chain
        ),
        expire: (k: string, s: number) => (log('expire', k, s), ops.push(() => 1), chain),
        exec: async () => ops.map((o) => [null, o()]),
      };
      return chain;
    },
    set: vi.fn(async (k: string, v: string, ...rest: unknown[]) => {
      log('set', k, v, ...rest);
      if (strings.has(k)) return null;
      strings.set(k, v);
      return 'OK';
    }),
  };
  return { redis, args };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('OtpSmsCapsService', () => {
  let alerts: { notifyOperators: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    alerts = { notifyOperators: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(Sentry.captureMessage).mockClear();
  });
  const make = () => {
    const r = fakeRedis();
    return { ...r, svc: new OtpSmsCapsService(r.redis as any, alerts as any) };
  };

  it('10 different numbers from one IP pass, the 11th is refused', async () => {
    const { svc } = make();
    for (let i = 0; i < 10; i++)
      expect(await svc.allowForIp('1.1.1.1', `+88017000000${i}`)).toBe(true);
    expect(await svc.allowForIp('1.1.1.1', '+8801799999999')).toBe(false);
  });

  it('the same number 20 times counts once', async () => {
    const { svc } = make();
    for (let i = 0; i < 20; i++)
      expect(await svc.allowForIp('1.1.1.1', '+8801700000000')).toBe(true);
  });

  it('another IP has its own count', async () => {
    const { svc } = make();
    for (let i = 0; i < 11; i++) await svc.allowForIp('1.1.1.1', `+88017000000${i}`);
    expect(await svc.allowForIp('2.2.2.2', '+8801799999999')).toBe(true);
  });

  it('a null ip is allowed and touches nothing', async () => {
    const { svc, args } = make();
    expect(await svc.allowForIp(null, '+8801700000000')).toBe(true);
    expect(args).toHaveLength(0);
  });

  it('platform ceiling: N allowed, N+1 refused', async () => {
    const { svc } = make();
    svc.platformLimit = 3;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await svc.allowPlatform());
    expect(results).toEqual([true, true, true, false]);
  });

  it('the ceiling alert fires exactly once per hour, however many are refused', async () => {
    const { svc } = make();
    svc.platformLimit = 1;
    for (let i = 0; i < 5; i++) await svc.allowPlatform();
    expect(alerts.notifyOperators).toHaveBeenCalledTimes(1);
    expect(alerts.notifyOperators.mock.calls[0][0]).toContain('email codes still work');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('OTP SMS platform ceiling reached', 'error');
  });

  it('writes only the sha256 of a number to Redis, never the number', async () => {
    const { svc, args } = make();
    const phone = '+8801712345678';
    await svc.allowForIp('1.1.1.1', phone);
    expect(args.find((a) => a[0] === 'sadd')?.[2]).toBe(sha(phone));
    expect(JSON.stringify(args)).not.toContain('1712345678');
  });

  it('countUsage bumps a daily counter with a 40-day TTL', async () => {
    const { svc, args } = make();
    await svc.countUsage();
    expect(args.find((a) => a[0] === 'incr')?.[1]).toMatch(/^usage:otp-sms:\d{8}$/);
    expect(args.find((a) => a[0] === 'expire')?.[2]).toBe(40 * 24 * 60 * 60);
  });
});
