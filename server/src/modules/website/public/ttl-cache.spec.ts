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

  it('runs one load for concurrent misses on a key, and separate loads for different keys', async () => {
    const c = new TtlCache<string>(5000, 5, () => 0);
    let release!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (release = r)));
    const calls = [c.get('a', load), c.get('a', load), c.get('a', load)];
    const other = c.get('b', async () => 'b');
    release('row');
    expect(await Promise.all(calls)).toEqual(['row', 'row', 'row']); // all share one DB read
    expect(await other).toBe('b');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('lets every waiter see a failed shared load, then loads again next time', async () => {
    const c = new TtlCache<number>(5000, 2);
    const fail = vi.fn(async () => Promise.reject(new Error('db down')));
    const both = Promise.allSettled([c.get('a', fail), c.get('a', fail)]);
    expect((await both).map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(await c.get('a', async () => 7)).toBe(7); // the failure was not kept
  });

  it('does not let a caller after clear() join a load that started before it', async () => {
    const c = new TtlCache<string>(5000, 2, () => 0);
    let release!: (v: string) => void;
    const old = c.get('a', () => new Promise<string>((r) => (release = r)));
    c.clear();
    expect(await c.get('a', async () => 'fresh')).toBe('fresh');
    release('stale');
    expect(await old).toBe('stale');
    expect(await c.get('a', async () => 'unused')).toBe('fresh'); // the fresh row is the cached one
  });

  it('does not share a load when the TTL is 0, so nothing joins a read that began earlier', async () => {
    const c = new TtlCache<number>(0);
    const load = vi.fn(async () => 1);
    await Promise.all([c.get('a', load), c.get('a', load)]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is a no-op by default under NODE_ENV=test, so specs never read stale rows', async () => {
    const c = new TtlCache<number>();
    let n = 0;
    await c.get('a', async () => ++n);
    expect(await c.get('a', async () => ++n)).toBe(2);
  });
});
