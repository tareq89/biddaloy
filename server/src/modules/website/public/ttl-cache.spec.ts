import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('loads once inside the ttl, again after it, and caches null', async () => {
    let t = 0;
    const c = new TtlCache<string | null>(5000, 3, () => t);
    const load = vi.fn(async () => null);
    await c.get('a', load);
    await c.get('a', load);
    expect(load).toHaveBeenCalledTimes(1);
    t = 5001;
    await c.get('a', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops the oldest entry past max size', async () => {
    const c = new TtlCache<number>(5000, 2, () => 0);
    const load = vi.fn(async () => 1);
    for (const k of ['a', 'b', 'c']) await c.get(k, load);
    await c.get('a', load); // evicted
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not cache a failed load', async () => {
    const c = new TtlCache<number>(5000, 2);
    await expect(c.get('a', async () => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(await c.get('a', async () => 7)).toBe(7);
  });

  it('does not write back a load that was in flight when clear() ran', async () => {
    const c = new TtlCache<string>(5000, 2, () => 0);
    let release!: (v: string) => void;
    const slow = c.get('a', () => new Promise<string>((r) => (release = r)));
    c.clear(); // e.g. SiteCacheService.invalidate after a site save
    release('stale');
    expect(await slow).toBe('stale'); // the waiting caller still gets its row...
    expect(await c.get('a', async () => 'fresh')).toBe('fresh'); // ...but it was not cached
  });

  it('is a no-op by default under NODE_ENV=test, so specs never read stale rows', async () => {
    const c = new TtlCache<number>();
    let n = 0;
    await c.get('a', async () => ++n);
    expect(await c.get('a', async () => ++n)).toBe(2);
  });
});
