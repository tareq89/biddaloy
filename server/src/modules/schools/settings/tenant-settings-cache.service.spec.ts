import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TenantSettingsCache } from './tenant-settings-cache.service';
import type { TenantSettings } from '@biddaloy/shared';

function settings(version = 1): TenantSettings {
  return { version } as TenantSettings;
}

describe('TenantSettingsCache', () => {
  let cache: TenantSettingsCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new TenantSettingsCache(1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the loader on the first read for a tenant', async () => {
    const load = vi.fn().mockResolvedValue(settings());

    const result = await cache.getOrLoad('school-1', load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(result).toEqual(settings());
  });

  it('returns the cached value on a second read within the TTL, without calling the loader again', async () => {
    const load = vi.fn().mockResolvedValue(settings());

    await cache.getOrLoad('school-1', load);
    vi.advanceTimersByTime(500);
    await cache.getOrLoad('school-1', load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('calls the loader again once the TTL has elapsed', async () => {
    const load = vi.fn().mockResolvedValue(settings());

    await cache.getOrLoad('school-1', load);
    vi.advanceTimersByTime(1001);
    await cache.getOrLoad('school-1', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches each tenant independently', async () => {
    const loadA = vi.fn().mockResolvedValue(settings(1));
    const loadB = vi.fn().mockResolvedValue(settings(1));

    await cache.getOrLoad('school-a', loadA);
    await cache.getOrLoad('school-b', loadB);
    await cache.getOrLoad('school-a', loadA);
    await cache.getOrLoad('school-b', loadB);

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it('invalidate forces the next read to call the loader again, even within the TTL', async () => {
    const load = vi.fn().mockResolvedValue(settings());

    await cache.getOrLoad('school-1', load);
    cache.invalidate('school-1');
    await cache.getOrLoad('school-1', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidating one tenant does not affect another', async () => {
    const loadA = vi.fn().mockResolvedValue(settings());
    const loadB = vi.fn().mockResolvedValue(settings());

    await cache.getOrLoad('school-a', loadA);
    await cache.getOrLoad('school-b', loadB);
    cache.invalidate('school-a');
    await cache.getOrLoad('school-a', loadA);
    await cache.getOrLoad('school-b', loadB);

    expect(loadA).toHaveBeenCalledTimes(2);
    expect(loadB).toHaveBeenCalledTimes(1);
  });
});
