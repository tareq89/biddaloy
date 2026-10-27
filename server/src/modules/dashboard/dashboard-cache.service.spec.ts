import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { DashboardCacheService } from './dashboard-cache.service';

describe('DashboardCacheService', () => {
  let redis: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let service: DashboardCacheService;
  const W = DashboardWidgetKey.ATTENDANCE_TODAY;

  beforeEach(() => {
    redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
    service = new DashboardCacheService(redis as never);
  });

  it('miss: runs the loader once and caches it for 60s under the tenant key', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    await expect(service.getOrLoad('t1', W, 'school', load)).resolves.toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'tenant:t1:dash:v1:attendance-today:school',
      JSON.stringify({ n: 1 }),
      'EX',
      60,
    );
  });

  it('collection-by-month is cached under v2 since its shape changed (#2941)', () => {
    expect(service.key('t1', DashboardWidgetKey.COLLECTION_BY_MONTH, 'school')).toBe(
      'tenant:t1:dash:v2:collection-by-month:school',
    );
  });

  it('a miss on collection-by-month reads and writes the v2 key, never v1', async () => {
    const k = 'tenant:t1:dash:v2:collection-by-month:school';
    await service.getOrLoad('t1', DashboardWidgetKey.COLLECTION_BY_MONTH, 'school', async () => ({
      n: 1,
    }));
    expect(redis.get).toHaveBeenCalledWith(k);
    expect(redis.set).toHaveBeenCalledWith(k, JSON.stringify({ n: 1 }), 'EX', 60);
  });

  it('hit: returns the parsed value without calling the loader', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ n: 2 }));
    const load = vi.fn();
    await expect(service.getOrLoad('t1', W, 'school', load)).resolves.toEqual({ n: 2 });
    expect(load).not.toHaveBeenCalled();
  });

  it('a read error falls back to the loader', async () => {
    redis.get.mockRejectedValue(new Error('down'));
    await expect(service.getOrLoad('t1', W, 'school', async () => 5)).resolves.toBe(5);
  });

  it('a write error still returns the loaded value', async () => {
    redis.set.mockRejectedValue(new Error('down'));
    await expect(service.getOrLoad('t1', W, 'school', async () => 5)).resolves.toBe(5);
  });

  it('does not cache undefined', async () => {
    await service.getOrLoad('t1', W, 'school', async () => undefined);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('keys differ per tenant', () => {
    expect(service.key('t1', W, 'school')).not.toBe(service.key('t2', W, 'school'));
  });
});
