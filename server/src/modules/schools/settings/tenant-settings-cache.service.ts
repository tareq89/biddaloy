import { Injectable } from '@nestjs/common';
import type { TenantSettings } from '@beton-boi/shared';

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

  constructor(private readonly ttlMs: number) {}

  async getOrLoad(tenantId: string, load: () => Promise<TenantSettings>): Promise<TenantSettings> {
    const cached = this.entries.get(tenantId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.settings;
    }

    const settings = await load();
    this.entries.set(tenantId, { settings, expiresAt: now + this.ttlMs });
    return settings;
  }

  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }
}
