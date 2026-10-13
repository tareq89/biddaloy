import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/** Thrown when the rate-limit store (Redis) cannot be reached. */
export class ThrottlerStorageUnavailableError extends Error {}

/**
 * Wraps the real (Redis-backed) storage. On any error it logs and throws
 * `ThrottlerStorageUnavailableError`: the storage only reports, `AppThrottlerGuard`
 * decides — fail closed for the `/auth/*` sign-in routes, fail open for the rest of the
 * app (Redis is already a hard dependency for BullMQ, so an outage here is already an
 * incident; the rate limiter shouldn't turn it into a site-wide 500 on top).
 * (File and class name kept from when this failed open everywhere.)
 */
@Injectable()
export class FailOpenThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(FailOpenThrottlerStorage.name);

  constructor(private readonly delegate: ThrottlerStorage) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.delegate.increment(key, ttl, limit, blockDuration, throttlerName);
    } catch (error) {
      this.logger.error(
        `Rate limiter storage unavailable: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ThrottlerStorageUnavailableError('Rate limiter storage unavailable');
    }
  }
}
