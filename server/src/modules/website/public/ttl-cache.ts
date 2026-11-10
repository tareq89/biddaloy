/**
 * Tiny in-process cache for the public site's hot lookups. Bounded, so made-up hosts cannot grow
 * memory; a failed load is never cached. Misses (null) are cached on purpose.
 * ponytail: no in-flight coalescing (concurrent misses each load); store the promise to add it.
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

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
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
  }
}
