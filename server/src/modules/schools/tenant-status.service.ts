import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import Redis from 'ioredis';
import { SchoolStatus } from '@biddaloy/shared';
import { School } from './entities/school.entity';

const POSTGRES_INVALID_TEXT_REPRESENTATION = '22P02';

function isInvalidUuidError(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as unknown as { code?: string }).code === POSTGRES_INVALID_TEXT_REPRESENTATION
  );
}

export const TENANT_STATUS_REDIS = 'TENANT_STATUS_REDIS';

const TENANT_STATUS_CACHE_TTL_SECONDS = 300;

/**
 * Caches each tenant's suspension status in Redis so `ContextGuard` can
 * check it on every authenticated request without a DB hit per request
 * (#527). Same fail-open-friendly Redis client pattern as
 * `AccessTokenDenylistService` / `LoginAttemptService` (see
 * `auth.module.ts`) — an outage here should degrade to "treat as active"
 * rather than break every request.
 */
@Injectable()
export class TenantStatusService {
  private readonly logger = new Logger(TenantStatusService.name);

  constructor(
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
  ) {}

  private key(tenantId: string): string {
    return `tenant:${tenantId}:status`;
  }

  async isActive(tenantId: string): Promise<boolean> {
    return (await this.getStatus(tenantId)) === SchoolStatus.ACTIVE;
  }

  /**
   * Same lookup as `isActive`, but tells "tenant doesn't exist" (`null`)
   * apart from "tenant exists but is SUSPENDED" — `isActive` collapses both
   * to `false`, which is fine for its callers (they only ever act on an
   * already-membership-validated tenant) but wrong for ContextGuard's
   * SUPER_ADMIN cross-tenant path, which has no membership row to fall back
   * on and must turn a nonexistent/malformed tenant id into a clean 401
   * instead of a 500 further downstream.
   */
  async getStatus(tenantId: string): Promise<SchoolStatus | null> {
    try {
      const cached = await this.redis.get(this.key(tenantId));
      if (cached) {
        return cached as SchoolStatus;
      }
    } catch (error) {
      this.logger.error(
        `Tenant status cache read failed for ${tenantId}, falling back to DB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let school: School | null;
    try {
      school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    } catch (error) {
      // `id` is a uuid-typed column — a syntactically malformed X-Tenant-ID
      // (e.g. "not-a-uuid") raises Postgres 22P02 here, not a normal "not
      // found". Only a platform SUPER_ADMIN's membership-less cross-tenant
      // path in ContextGuard reaches this with unvalidated input — everyone
      // else 401s at the membership check first — but it must still resolve
      // to the same "tenant does not exist" 401 rather than surfacing as an
      // unhandled 500.
      if (isInvalidUuidError(error)) {
        return null;
      }
      throw error;
    }
    // A tenant that no longer exists (or was soft-deleted) isn't "active" —
    // let ContextGuard's own membership check handle the "not a member"
    // case; this just refuses to cache a false "active".
    const status = school?.status ?? null;

    try {
      if (status) {
        await this.redis.set(this.key(tenantId), status, 'EX', TENANT_STATUS_CACHE_TTL_SECONDS);
      }
    } catch (error) {
      this.logger.error(
        `Tenant status cache write failed for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return status as SchoolStatus | null;
  }

  /**
   * Looks up a school's id by slug. Used by `ContextGuard` to dynamically
   * resolve the platform tenant outside production when `PLATFORM_TENANT_ID`
   * isn't set — see that guard's `resolvePlatformTenantId()` for the fix
   * this exists for (#620): no database actually has the old hardcoded
   * dev id, since the `MultiTenantAuth` migration inserts the real
   * "Default School" row with a random uuid. Not Redis-cached like
   * `getStatus`/`isActive` — a school's slug is effectively immutable, so
   * `ContextGuard` caches the resolved id itself for the process lifetime
   * instead of re-querying per request.
   */
  async findSchoolIdBySlug(slug: string): Promise<string | null> {
    const school = await this.schoolRepo.findOne({ where: { slug } });
    return school?.id ?? null;
  }

  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.del(this.key(tenantId));
    } catch (error) {
      this.logger.error(
        `Tenant status cache invalidation failed for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
