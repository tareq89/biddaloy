import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { DashboardCacheService } from './dashboard-cache.service';

describe('DashboardCacheService (real Redis)', () => {
  let redis: Redis;
  let service: DashboardCacheService;
  const W = DashboardWidgetKey.ATTENDANCE_TODAY;
  const used: string[] = [];
  // Unique per run so two copies of the suite sharing one Redis never touch each other's keys.
  const RUN = randomUUID().slice(0, 8);

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    service = new DashboardCacheService(redis);
  });

  afterEach(async () => {
    if (used.length) await redis.del(...used);
    used.length = 0;
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('sets a TTL of at most 60s after a miss', async () => {
    const key = service.key(`it-t1-${RUN}`, W, 'school');
    used.push(key);
    await service.getOrLoad(`it-t1-${RUN}`, W, 'school', async () => ({ n: 1 }));
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('serves the second call from cache', async () => {
    used.push(service.key(`it-t1-${RUN}`, W, 'school'));
    const load = vi.fn().mockResolvedValue({ n: 1 });
    await service.getOrLoad(`it-t1-${RUN}`, W, 'school', load);
    await service.getOrLoad(`it-t1-${RUN}`, W, 'school', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  // Tenant isolation: a value cached for tenant A is never returned to tenant B.
  it('does not return tenant A value to tenant B', async () => {
    used.push(service.key(`it-a-${RUN}`, W, 'school'), service.key(`it-b-${RUN}`, W, 'school'));
    await service.getOrLoad(`it-a-${RUN}`, W, 'school', async () => 'A');
    const loadB = vi.fn().mockResolvedValue('B');
    await expect(service.getOrLoad(`it-b-${RUN}`, W, 'school', loadB)).resolves.toBe('B');
    expect(loadB).toHaveBeenCalledTimes(1);
  });
});
