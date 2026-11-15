import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OtpService, TooManyRequestsException } from './otp.service';

// Runs the real REQUEST_SCRIPT in Redis: a restored cap key at the cap but with no TTL must get its
// expiry back while rejecting, otherwise the destination is locked out forever.
describe('OtpService cap bucket without an expiry (integration)', () => {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  const service = new OtpService(redis, {
    get: (key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined),
  } as unknown as ConfigService);

  beforeEach(async () => {
    await redis.flushdb();
  });
  afterAll(() => {
    redis.disconnect();
  });

  it('repairs a missing expiry on an exhausted bucket before returning 429', async () => {
    await redis.set('otp-cap:LOGIN:user@test.com', '5'); // no TTL, as after a restore
    await expect(service.request('LOGIN', 'user@test.com')).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
    const ttl = await redis.pttl('otp-cap:LOGIN:user@test.com');
    expect(ttl).toBeGreaterThan(0);
  });
});
