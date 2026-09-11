import { Injectable, Inject, Logger, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

export const BULK_IMPORT_REDIS = 'BULK_IMPORT_REDIS';

export const MAX_STAGED_PAYLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
export const DEFAULT_STAGING_TTL_SEC = 1800; // 30 minutes

interface StagedEnvelope<T> {
  userId: string;
  createdAt: string;
  payload: T;
}

/**
 * Domain-agnostic staging for a validated bulk-import payload: a caller
 * validates a workbook (or whatever) client-side/server-side, stages the
 * result here, and a later step either peeks at it (to show a summary) or
 * consumes it exactly once (to commit it). Nothing in this service knows
 * about students, workbooks, or any other domain — it only moves opaque
 * JSON-serialisable payloads through Redis with a TTL.
 *
 * Cross-tenant *and* cross-user isolation both come from the key
 * (`bulk-import:<tenant>:<user>:*`) — `userId` is never client-supplied, it
 * comes from the authenticated request, so a caller can only ever compute
 * their own key. This is what stops a leaked/guessed `stagingId` from being
 * a way to *destroy* another user's stage: `consume`'s `GETDEL` on the wrong
 * key simply misses, rather than deleting the real entry before the
 * `userId` check inside the envelope gets a chance to reject it. The
 * envelope's own `userId` field is kept as defence in depth, not as the
 * primary isolation boundary.
 *
 * Unlike AccessTokenDenylistService, this does NOT fail open on a Redis
 * error. A swallowed error here would silently lose a user's validated
 * import, or worse, make a `consume` failure look identical to "already
 * used". Errors from `stage`/`peek`/`consume` propagate to the caller after
 * being logged.
 */
@Injectable()
export class ImportStagingService {
  private readonly logger = new Logger(ImportStagingService.name);

  constructor(@Inject(BULK_IMPORT_REDIS) private readonly redis: Redis) {}

  private key(tenantId: string, userId: string, stagingId: string): string {
    return `bulk-import:${tenantId}:${userId}:${stagingId}`;
  }

  async stage<T>(
    tenantId: string,
    userId: string,
    payload: T,
    ttlSec: number = DEFAULT_STAGING_TTL_SEC,
  ): Promise<{ stagingId: string; expiresAt: string }> {
    const envelope: StagedEnvelope<T> = {
      userId,
      createdAt: new Date().toISOString(),
      payload,
    };
    const serialised = JSON.stringify(envelope);
    const sizeBytes = Buffer.byteLength(serialised, 'utf8');
    if (sizeBytes > MAX_STAGED_PAYLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `Staged payload of ${sizeBytes} bytes exceeds the ${MAX_STAGED_PAYLOAD_BYTES} byte limit`,
      );
    }

    const stagingId = randomUUID();
    try {
      await this.redis.set(this.key(tenantId, userId, stagingId), serialised, 'EX', ttlSec);
    } catch (error) {
      this.logger.error(
        `Failed to stage bulk import for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    return {
      stagingId,
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
    };
  }

  private parse<T>(raw: string | null, userId: string): T | null {
    if (raw === null) return null;
    let envelope: StagedEnvelope<T>;
    try {
      envelope = JSON.parse(raw) as StagedEnvelope<T>;
    } catch (error) {
      // A corrupt stage is indistinguishable from an absent one to the
      // caller — log it for diagnosis but don't throw.
      this.logger.error(
        `Malformed staged import payload: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    // JSON.parse succeeds on any valid JSON, not just objects (e.g. `null`,
    // `42`, `"x"`) — guard before touching `.userId` so a corrupt-but-valid
    // stage still returns null instead of throwing.
    if (typeof envelope !== 'object' || envelope === null) return null;
    if (envelope.userId !== userId) return null;
    return envelope.payload;
  }

  async peek<T>(tenantId: string, userId: string, stagingId: string): Promise<T | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(this.key(tenantId, userId, stagingId));
    } catch (error) {
      this.logger.error(
        `Failed to peek staged import ${stagingId} for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    return this.parse<T>(raw, userId);
  }

  async consume<T>(tenantId: string, userId: string, stagingId: string): Promise<T | null> {
    let raw: string | null;
    try {
      // GETDEL (atomic get-then-delete, Redis >= 6.2) rather than GET+DEL —
      // atomicity is what makes a double-commit from two concurrent
      // `consume` calls impossible. A non-atomic GET followed by DEL would
      // let both calls read the payload before either deletes the key.
      raw = await this.redis.getdel(this.key(tenantId, userId, stagingId));
    } catch (error) {
      this.logger.error(
        `Failed to consume staged import ${stagingId} for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    return this.parse<T>(raw, userId);
  }
}
