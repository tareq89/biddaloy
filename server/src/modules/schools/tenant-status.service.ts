import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { SchoolStatus } from '@biddaloy/shared';
import { School } from './entities/school.entity';

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
    try {
      const cached = await this.redis.get(this.key(tenantId));
      if (cached) {
        return cached === SchoolStatus.ACTIVE;
      }
    } catch (error) {
      this.logger.error(
        `Tenant status cache read failed for ${tenantId}, falling back to DB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
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

    return status === SchoolStatus.ACTIVE;
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
