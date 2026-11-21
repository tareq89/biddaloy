import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Redis from 'ioredis';
import { OtpSmsCapsService } from './otp-sms-caps.service';

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));

describe('OtpSmsCapsService (real Redis)', () => {
  let redis: Redis;
  const alerts = { notifyOperators: vi.fn().mockResolvedValue(undefined) };

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  });
  afterAll(() => {
    redis.disconnect();
  });
  beforeEach(async () => {
    alerts.notifyOperators.mockClear();
    await redis.flushdb();
  });

  it('10 parallel platform checks against a ceiling of 3: exactly 3 allowed, one alert', async () => {
    const svc = new OtpSmsCapsService(redis, alerts as any);
    svc.platformLimit = 3;
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.allowPlatform()));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(alerts.notifyOperators).toHaveBeenCalledTimes(1);
  });

  it('10 parallel different numbers from one IP with a limit of 3: exactly 3 allowed', async () => {
    const svc = new OtpSmsCapsService(redis, alerts as any);
    svc.perIpLimit = 3;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => svc.allowForIp('9.9.9.9', `+88017000000${i}`)),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it('keeps no clear phone number in any key or member', async () => {
    const svc = new OtpSmsCapsService(redis, alerts as any);
    await svc.allowForIp('9.9.9.9', '+8801712345678');
    const keys = await redis.keys('*');
    const dump = JSON.stringify([keys, ...(await Promise.all(keys.map((k) => redis.smembers(k))))]);
    expect(dump).not.toContain('1712345678');
  });
});
