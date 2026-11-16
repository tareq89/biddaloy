import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { CommunicationMedium } from '@biddaloy/shared';
import { SendLimitService } from './send-limit.service';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

/** Fakes: school settings, platform value, and a Redis whose eval/get/exists we control. */
function make(opts: { school?: unknown; platform?: unknown; eval?: any; get?: any } = {}) {
  const redis = {
    eval: opts.eval ?? vi.fn().mockResolvedValue(1),
    get: opts.get ?? vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockResolvedValue(0),
  };
  const schools = {
    getDecryptedSettings: vi
      .fn()
      .mockResolvedValue({ communications: { dailyLimits: opts.school } }),
  };
  const cache = { getOrLoad: (_id: string, load: () => Promise<unknown>) => load() };
  const platform = { get: vi.fn().mockResolvedValue(opts.platform) };
  const svc = new SendLimitService(redis as any, schools as any, cache as any, platform as any);
  return { svc, redis, platform };
}

describe('SendLimitService', () => {
  afterEach(() => vi.useRealTimers());

  describe('effectiveLimits', () => {
    it('school value wins', async () => {
      const { svc } = make({ school: { sms: 5 }, platform: { sms: 9 } });
      expect((await svc.effectiveLimits('t')).sms).toBe(5);
    });
    it('school unset falls to platform, then to the default 2000', async () => {
      const { svc } = make({ platform: { sms: 9 } });
      expect(await svc.effectiveLimits('t')).toEqual({ sms: 9, email: 2000, whatsapp: 2000 });
    });
    it('a school {} (every stored value invalid) never means no limit', async () => {
      const { svc } = make({ school: {}, platform: { email: 7 } });
      expect(await svc.effectiveLimits('t')).toEqual({ sms: 2000, email: 7, whatsapp: 2000 });
    });
    it('an invalid platform value is ignored', async () => {
      const { svc } = make({ platform: { sms: -3, email: 'x' } });
      expect((await svc.effectiveLimits('t')).sms).toBe(2000);
    });
    it('invalidateDefaults makes the next read fresh', async () => {
      const { svc, platform } = make({ platform: { sms: 9 } });
      await svc.effectiveLimits('t');
      await svc.effectiveLimits('t');
      expect(platform.get).toHaveBeenCalledTimes(1);
      svc.invalidateDefaults();
      await svc.effectiveLimits('t');
      expect(platform.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('tryCount', () => {
    it('under the limit is OK', async () => {
      const { svc } = make({ eval: vi.fn().mockResolvedValue(1) });
      expect(await svc.tryCount('t', CommunicationMedium.SMS)).toBe('OK');
    });
    it('at the limit is refused with the limit (the script rolls the count back)', async () => {
      const { svc, redis } = make({ school: { sms: 5 }, eval: vi.fn().mockResolvedValue(0) });
      expect(await svc.tryCount('t', CommunicationMedium.SMS)).toEqual({ remaining: 0, limit: 5 });
      // Script: DECR on refusal, flag SET NX (once per day).
      const [script, , counterKey, flagKey, limit] = redis.eval.mock.calls[0];
      expect(script).toContain("redis.call('DECR'");
      expect(script).toContain("'NX'");
      expect(counterKey).toMatch(/^send-limit:t:sms:\d{8}$/);
      expect(flagKey).toMatch(/^send-limit-hit:t:sms:\d{8}$/);
      expect(limit).toBe(5);
    });
    it('Redis throws: fail open and report to Sentry', async () => {
      const { svc } = make({ eval: vi.fn().mockRejectedValue(new Error('down')) });
      expect(await svc.tryCount('t', CommunicationMedium.SMS)).toBe('OK');
      expect(Sentry.captureException).toHaveBeenCalled();
    });
    it('the key uses the Asia/Dhaka day: 23:30 UTC is already the next day', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-10T23:30:00Z'));
      const { svc, redis } = make();
      await svc.tryCount('t', CommunicationMedium.SMS);
      expect(redis.eval.mock.calls[0][2]).toBe('send-limit:t:sms:20260311');
    });
  });

  describe('remaining / hitToday', () => {
    it('remaining = limit - used, never negative', async () => {
      const { svc } = make({ school: { sms: 5 }, get: vi.fn().mockResolvedValue('3') });
      expect(await svc.remaining('t', CommunicationMedium.SMS)).toEqual({ limit: 5, remaining: 2 });
    });
    it('remaining on a Redis failure fails open: room for any batch', async () => {
      const { svc } = make({ get: vi.fn().mockRejectedValue(new Error('down')) });
      const r = await svc.remaining('t', CommunicationMedium.SMS);
      expect(r.remaining).toBeGreaterThan(r.limit);
    });
    it('a platform-default load that predates invalidateDefaults does not refill the cache', async () => {
      let release!: (v: unknown) => void;
      const platformGet = vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => (release = r)))
        .mockResolvedValue({ sms: 7 });
      const { svc } = make();
      (svc as any).platform = { get: platformGet };
      const stale = svc.effectiveLimits('t');
      await Promise.resolve();
      svc.invalidateDefaults();
      release({ sms: 1 });
      await stale;
      expect((await svc.effectiveLimits('t')).sms).toBe(7);
    });
    it('hitToday lists channels whose flag exists', async () => {
      const { svc, redis } = make();
      redis.exists.mockImplementation(async (k: string) => (k.includes(':email:') ? 1 : 0));
      expect(await svc.hitToday('t')).toEqual([CommunicationMedium.EMAIL]);
    });
  });
});
