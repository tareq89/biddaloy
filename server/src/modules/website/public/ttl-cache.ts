/**
 * Tiny in-process cache for the public site's hot lookups. Bounded, so made-up hosts cannot grow
 * memory; a failed load is never cached. Misses (null) are cached on purpose.
 * Concurrent misses on one key share a single load (no thundering herd on a cold host).
 * ponytail: per-process, oldest-inserted eviction; swap for a real LRU only if hit rate matters.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();

  constructor(
    // 0 under jest/e2e (NODE_ENV=test, as the throttler is skipped there): specs publish a site and
    // read it back at once, so a 5 s cache would serve them stale rows.
    private readonly ttlMs = process.env.NODE_ENV === 'test' ? 0 : 5_000,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  // Bumped by clear(): a load that started before a clear() must not write its (stale) row back
  // after it, or an invalidation would be undone for up to one TTL.
  private generation = 0;

  // One load per key at a time: concurrent misses share the first caller's promise. Bounded by
  // the number of live loads (each removes itself when settled), so made-up hosts cannot grow it.
  private readonly inflight = new Map<string, Promise<V>>();

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return Promise.resolve(hit.value);
    // A zero TTL means "no cache" (NODE_ENV=test): never share a load, or a request made after a
    // change could join a read that started before it.
    if (this.ttlMs === 0) return this.fill(key, load);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.fill(key, load).finally(() => {
      // clear() may have replaced this entry with a newer load: only remove our own.
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  private async fill(key: string, load: () => Promise<V>): Promise<V> {
    const startedAt = this.generation;
    const value = await load();
    if (startedAt !== this.generation) return value;
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    return value;
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
    // A caller after clear() must start its own, fresh load, not join a pre-clear (stale) one.
    this.inflight.clear();
  }
}
