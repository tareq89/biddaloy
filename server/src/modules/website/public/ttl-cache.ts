/**
 * Tiny in-process cache for the public site's hot lookups. Bounded, so made-up hosts cannot grow
 * memory; a failed load is never cached. Misses (null) are cached on purpose.
 * ponytail: per-process, oldest-inserted eviction; swap for a real LRU only if hit rate matters.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs = 5_000,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = await load();
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
