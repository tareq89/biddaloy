import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { DashboardWidgetKey } from '@biddaloy/shared';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';

export const DASHBOARD_CACHE_TTL_SECONDS = 60;

/**
 * 60-second widget cache on the shared fail-fast Redis client
 * (`TENANT_STATUS_REDIS`, global). Keys are `tenant:<id>:dash:<widget>:<scope>`;
 * `scope` is chosen by the caller (`school`, `user:<id>`, `section:<id>`), so a
 * per-user or per-section widget never leaks to another user or tenant.
 *
 * Redis down (Rule 15): a read or write error is logged and the loader runs.
 * Never a 500. Cached values must be JSON-safe (ISO strings, never `Date`).
 */
@Injectable()
export class DashboardCacheService {
  private readonly logger = new Logger(DashboardCacheService.name);

  constructor(@Inject(TENANT_STATUS_REDIS) private readonly redis: Redis) {}

  key(tenantId: string, widget: DashboardWidgetKey, scope: string): string {
    return `tenant:${tenantId}:dash:${widget}:${scope}`;
  }

  async getOrLoad<T>(
    tenantId: string,
    widget: DashboardWidgetKey,
    scope: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const key = this.key(tenantId, widget, scope);
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch (error) {
      this.logger.error(`Dashboard cache read failed for ${key}: ${String(error)}`);
    }

    const value = await load();
    if (value === undefined) return value;

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', DASHBOARD_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Dashboard cache write failed for ${key}: ${String(error)}`);
    }
    return value;
  }
}
