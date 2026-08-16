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

  it('starts the TTL when load() resolves, not when it is called', async () => {
    let resolveLoad!: (value: TenantSettings) => void;
    const load = vi.fn(
      () =>
        new Promise<TenantSettings>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const pending = cache.getOrLoad('school-1', load);
    // load() itself takes 900ms of the 1000ms TTL — if expiresAt had been
    // computed before awaiting load(), the entry would already be almost
    // expired the moment it's stored.
    vi.advanceTimersByTime(900);
    resolveLoad(settings());
    await pending;

    // Advancing by another 900ms would blow past a TTL that started at
    // call time (900 + 900 > 1000), but should still be within a TTL that
    // started when load() resolved.
    vi.advanceTimersByTime(900);
    const reload = vi.fn().mockResolvedValue(settings());
    await cache.getOrLoad('school-1', reload);

    expect(reload).not.toHaveBeenCalled();
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

  it('does not resurrect a retired value when invalidate() lands while a load() is still pending', async () => {
    let resolveLoad!: (value: TenantSettings) => void;
    const load = vi.fn(
      () =>
        new Promise<TenantSettings>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    // load() starts, then invalidate() runs before it resolves — the
    // classic race: without the generation check, the settings load()
    // eventually returns would get stored right after invalidate()
    // deleted the entry it was meant to retire.
    const pending = cache.getOrLoad('school-1', load);
    cache.invalidate('school-1');
    resolveLoad(settings(1));
    await pending;

    const reload = vi.fn().mockResolvedValue(settings(2));
    await cache.getOrLoad('school-1', reload);

    // If the stale result had been cached, this second read would return
    // it without calling the loader again.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('removes an expired entry from memory before reloading, not after', async () => {
    const firstLoad = vi.fn().mockResolvedValue(settings());
    await cache.getOrLoad('school-1', firstLoad);
    vi.advanceTimersByTime(1001);

    let resolveReload!: (value: TenantSettings) => void;
    const reload = vi.fn(
      () =>
        new Promise<TenantSettings>((resolve) => {
          resolveReload = resolve;
        }),
    );
    const pending = cache.getOrLoad('school-1', reload);

    // While the reload is still in flight, the expired (decrypted,
    // plaintext-credential) entry must already be gone from the map, not
    // sitting in memory until this reload happens to overwrite it.
    expect((cache as unknown as { entries: Map<string, unknown> }).entries.has('school-1')).toBe(
      false,
    );

    resolveReload(settings());
    await pending;
  });
});
