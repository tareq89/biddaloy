import { Injectable } from '@nestjs/common';
import type { TenantSettings } from '@biddaloy/shared';

interface CacheEntry {
  settings: TenantSettings;
  expiresAt: number;
}

/**
 * A short-lived, per-tenant cache in front of `SchoolsService`'s settings
 * read (decrypt included) — #8.7.10's per-tenant provider resolver would
 * otherwise pay a DB read plus a decrypt on every single outbound
 * message, for settings that change on the order of "a school admin
 * clicks save," not per request.
 *
 * Invalidated explicitly on write (`SchoolsService.updateSettings` calls
 * `invalidate()` after persisting), with a short TTL as the backstop for
 * any write path that doesn't go through that method — a stale read past
 * the TTL self-corrects rather than staying wrong indefinitely.
 *
 * Invalidation is process-local and best-effort, not a distributed
 * invariant: `entries` is a plain in-memory `Map`, so in a multi-instance
 * deployment `invalidate()` only clears the copy held by *this* process.
 * The TTL — not `invalidate()` — is the real staleness bound any other
 * replica is subject to; a credential rotated on one instance can still
 * be served by another for up to `ttlMs`. If that bound ever needs to be
 * tightened across replicas, invalidation would need to be published
 * (e.g. over the Redis connection BullMQ already requires) rather than
 * just widening this comment's claim.
 *
 * Entries also don't outlive the TTL in memory: `getOrLoad` deletes an
 * expired entry on read rather than leaving the old (decrypted, plaintext)
 * value in the map until the next read happens to overwrite it — this
 * cache holds real credentials, so their in-memory lifetime should match
 * the documented TTL, not "until this tenant is read again."
 *
 * Constructed via a `useFactory` provider in `SchoolsModule`, not a bare
 * `providers: [TenantSettingsCache]` entry — Nest's constructor injection
 * has no provider for a bare `number`, so a real app boot would fail
 * trying to resolve `ttlMs` as a dependency token. The factory just calls
 * `new TenantSettingsCache(30_000)` directly, and tests construct it the
 * same way with a short TTL for fast, deterministic assertions.
 */
@Injectable()
export class TenantSettingsCache {
  private readonly entries = new Map<string, CacheEntry>();
  // Bumped by invalidate(). Lets a load() already in flight when an
  // invalidation lands notice its result is for settings that no longer
  // exist, so it can return that result to its own caller without
  // resurrecting it into the cache — otherwise a slow load racing a fast
  // invalidate() could win and store retired settings right after
  // invalidate() deleted them.
  private readonly generations = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  async getOrLoad(tenantId: string, load: () => Promise<TenantSettings>): Promise<TenantSettings> {
    const cached = this.entries.get(tenantId);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.settings;
      }
      this.entries.delete(tenantId);
    }

    const generationBeforeLoad = this.generations.get(tenantId) ?? 0;
    const settings = await load();
    if ((this.generations.get(tenantId) ?? 0) !== generationBeforeLoad) {
      return settings;
    }
    // Timestamp taken after load() resolves, not before — the TTL covers
    // this entry's actual time in the cache, not load() plus the TTL, so a
    // slow load doesn't leave the entry with a shortened (or already
    // expired) lifetime.
    this.entries.set(tenantId, { settings, expiresAt: Date.now() + this.ttlMs });
    return settings;
  }

  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
    this.generations.set(tenantId, (this.generations.get(tenantId) ?? 0) + 1);
  }
}
