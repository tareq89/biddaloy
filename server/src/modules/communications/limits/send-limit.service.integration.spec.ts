import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { CommunicationMedium } from '@biddaloy/shared';
import { SendLimitService } from './send-limit.service';

/** Real Redis. Tenant ids are unique per run, so no flushdb and no clash with other specs. */
describe('SendLimitService (integration)', () => {
  let redis: Redis;
  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  });
  afterAll(() => {
    redis.disconnect();
  });
  // Fixed instant: a run across midnight Asia/Dhaka must not split the daily counter. Only Date is
  // faked, so ioredis timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T06:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const service = (limit: number) =>
    new SendLimitService(
      redis,
      {
        getDecryptedSettings: async () => ({ communications: { dailyLimits: { sms: limit } } }),
      } as any,
      { getOrLoad: (_id: string, load: () => Promise<unknown>) => load() } as any,
      { get: async () => undefined } as any,
    );

  it('20 parallel sends with limit 5: exactly 5 OK, count stays at 5, flag raised', async () => {
    const tenant = randomUUID();
    const svc = service(5);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => svc.tryCount(tenant, CommunicationMedium.SMS)),
    );
    expect(results.filter((r) => r === 'OK')).toHaveLength(5);
    expect(await svc.remaining(tenant, CommunicationMedium.SMS)).toEqual({
      limit: 5,
      remaining: 0,
    });
    expect(await svc.hitToday(tenant)).toEqual([CommunicationMedium.SMS]);
  });

  it("tenant A's count does not move tenant B's", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const svc = service(3);
    for (let i = 0; i < 3; i++) await svc.tryCount(a, CommunicationMedium.SMS);
    expect(await svc.tryCount(a, CommunicationMedium.SMS)).not.toBe('OK');
    expect(await svc.tryCount(b, CommunicationMedium.SMS)).toBe('OK');
    expect(await svc.hitToday(b)).toEqual([]);
  });
});
