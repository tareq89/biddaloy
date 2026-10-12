import { Injectable, Inject, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { SchoolStatus } from '@biddaloy/shared';
import { School } from './entities/school.entity';
import { isLocked } from '../workbook/restore/restore-lock';

const POSTGRES_INVALID_TEXT_REPRESENTATION = '22P02';

function isInvalidUuidError(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as unknown as { code?: string }).code === POSTGRES_INVALID_TEXT_REPRESENTATION
  );
}

export const TENANT_STATUS_REDIS = 'TENANT_STATUS_REDIS';

const TENANT_STATUS_CACHE_TTL_SECONDS = 300;

/** At most one Sentry event per this window for a failing restore-lock read (#2210 F3). */
const RESTORE_LOCK_READ_REPORT_INTERVAL_MS = 60_000;

/**
 * The one 423 every write path returns while a tenant's restore runs (#2210): `ContextGuard`,
 * the public admission submit and device ingest. Same `{message, details.code}` shape as the
 * `TENANT_SUSPENDED` 403.
 */
export function tenantRestoringException(): HttpException {
  return new HttpException(
    {
      message: 'This school is being restored from a backup. Try again when it finishes.',
      details: { code: 'TENANT_RESTORING' },
    },
    HttpStatus.LOCKED,
  );
}

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
  private lastRestoreLockReadReport = 0;

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

  /**
   * Why a school is suspended. Cached like the status (same TTL, cleared by `invalidate`): a
   * suspended school's open tabs keep polling, so every refused request would otherwise hit the
   * DB. `''` caches "no reason".
   */
  async getStatusReason(tenantId: string): Promise<string | null> {
    const key = `${this.key(tenantId)}_reason`;
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return cached || null;
    } catch (error) {
      this.logger.error(
        `Tenant status reason cache read failed for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const school = await this.schoolRepo.findOne({
      where: { id: tenantId },
      select: { id: true, status_reason: true },
    });
    if (!school) return null;
    try {
      await this.redis.set(key, school.status_reason ?? '', 'EX', TENANT_STATUS_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.error(
        `Tenant status reason cache write failed for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return school.status_reason;
  }

  /**
   * True while a backup restore holds this tenant's lock. Fail-open on Redis errors like
   * `getStatus` (request guards must not 5xx every write on an outage) — unless `failClosed`:
   * schedulers and workers can retry later, so an unreadable lock counts as locked for them.
   * A fail-open during a real restore lets writes back in, so the failure also
   * goes to Sentry (rate-limited: a Redis outage fails every write request).
   */
  async isRestoring(tenantId: string, opts: { failClosed?: boolean } = {}): Promise<boolean> {
    try {
      return await isLocked(this.redis, tenantId);
    } catch (error) {
      this.logger.warn(
        `Restore-lock read failed for ${tenantId}, treating as ${opts.failClosed ? 'restoring' : 'not restoring'}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // ponytail: one process-wide window, not per tenant; a per-tenant map if one noisy tenant hides another.
      if (Date.now() - this.lastRestoreLockReadReport >= RESTORE_LOCK_READ_REPORT_INTERVAL_MS) {
        this.lastRestoreLockReadReport = Date.now();
        Sentry.withScope((scope) => {
          scope.setTags({ tenant_id: tenantId, check: 'restore-lock-read' });
          Sentry.captureException(error);
        });
      }
      return opts.failClosed === true;
    }
  }

  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.del(this.key(tenantId), `${this.key(tenantId)}_reason`);
    } catch (error) {
      this.logger.error(
        `Tenant status cache invalidation failed for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
