import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/**
 * Wraps the real (Redis-backed) storage and fails open on any error —
 * Redis is already a hard dependency for BullMQ, so an outage here is
 * already an incident; the rate limiter shouldn't turn a Redis blip into
 * a site-wide 500 on top of it.
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
        `Rate limiter storage unavailable, failing open: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
