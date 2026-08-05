import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export const ACCESS_TOKEN_DENYLIST_REDIS = 'ACCESS_TOKEN_DENYLIST_REDIS';

/**
 * Lets a single access token be revoked before its natural expiry —
 * needed for logout-all and reuse-detected family revocation, where
 * waiting out the token's own ~15 minute lifetime isn't acceptable. A
 * denylist entry per jti is only viable because that lifetime is now
 * short; this deliberately doesn't attempt a full blacklist of every
 * issued token, which is the whole point of shortening access tokens in
 * the first place (see auth.module.ts / #42's plan).
 *
 * Fails open on a Redis error, same reasoning as
 * FailOpenThrottlerStorage/LoginAttemptService: an outage here should
 * degrade to "revocation takes up to 15 minutes to take effect" rather
 * than "every request breaks" or "every request hangs waiting on a dead
 * connection".
 */
@Injectable()
export class AccessTokenDenylistService {
  private readonly logger = new Logger(AccessTokenDenylistService.name);

  constructor(@Inject(ACCESS_TOKEN_DENYLIST_REDIS) private readonly redis: Redis) {}

  private key(jti: string): string {
    return `access-denylist:${jti}`;
  }

  async revoke(jti: string, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return;
    try {
      await this.redis.set(this.key(jti), '1', 'PX', ttlMs);
    } catch (error) {
      this.logger.error(
        `Failed to denylist access token ${jti}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.key(jti))) === 1;
    } catch (error) {
      this.logger.error(
        `Denylist check failed for ${jti}, failing open: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
