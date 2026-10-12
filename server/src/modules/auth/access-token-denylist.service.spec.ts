import { describe, it, expect, vi } from 'vitest';
import { AccessTokenDenylistService } from './access-token-denylist.service';

function fakeRedis() {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    mget: vi.fn().mockResolvedValue([null, null]),
  };
}

describe('AccessTokenDenylistService', () => {
  describe('revoke', () => {
    it('sets a key with the given TTL', async () => {
      const redis = fakeRedis();
      const service = new AccessTokenDenylistService(redis as any);

      await service.revoke('jti-1', 900_000);

      expect(redis.set).toHaveBeenCalledWith('access-denylist:jti-1', '1', 'PX', 900_000);
    });

    it('does nothing for a non-positive TTL', async () => {
      const redis = fakeRedis();
      const service = new AccessTokenDenylistService(redis as any);

      await service.revoke('jti-1', 0);
      await service.revoke('jti-1', -1);

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('swallows a Redis error rather than throwing', async () => {
      const redis = fakeRedis();
      redis.set.mockRejectedValue(new Error('connection refused'));
      const service = new AccessTokenDenylistService(redis as any);

      await expect(service.revoke('jti-1', 900_000)).resolves.toBeUndefined();
    });
  });

  describe('revokeUserTokensIssuedBefore', () => {
    it('stores the cut-off in epoch seconds with the TTL', async () => {
      const redis = fakeRedis();
      const service = new AccessTokenDenylistService(redis as any);

      await service.revokeUserTokensIssuedBefore('u1', new Date(1_700_000_000_900), 900_000);

      expect(redis.set).toHaveBeenCalledWith(
        'access-denylist:user:u1',
        '1700000000900',
        'PX',
        900_000,
      );
    });
  });

  describe('isRevoked', () => {
    const payload = { jti: 'jti-1', sub: 'u1', iat: 1000 };

    it('a jti entry still revokes', async () => {
      const redis = fakeRedis();
      redis.mget.mockResolvedValue(['1', null]);
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked(payload)).toBe(true);
      expect(redis.mget).toHaveBeenCalledWith('access-denylist:jti-1', 'access-denylist:user:u1');
    });

    it('returns false when neither key exists', async () => {
      const service = new AccessTokenDenylistService(fakeRedis() as any);

      expect(await service.isRevoked(payload)).toBe(false);
    });

    it('a token with iat_ms before the user cut-off is revoked', async () => {
      const redis = fakeRedis();
      redis.mget.mockResolvedValue([null, '2000500']);
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked({ ...payload, iat_ms: 2000000 })).toBe(true);
    });

    it('a token issued 1ms after the cut-off in the same second is accepted', async () => {
      const redis = fakeRedis();
      redis.mget.mockResolvedValue([null, '2000500']);
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked({ ...payload, iat: 2000, iat_ms: 2000501 })).toBe(false);
    });

    it('a legacy token (iat only) from an earlier second is revoked', async () => {
      const redis = fakeRedis();
      redis.mget.mockResolvedValue([null, '2000500']);
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked({ ...payload, iat: 1999 })).toBe(true);
    });

    it('a legacy token (iat only) from the cut-off second is assumed issued at its end and accepted', async () => {
      const redis = fakeRedis();
      redis.mget.mockResolvedValue([null, '2000500']);
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked({ ...payload, iat: 2000 })).toBe(false);
    });

    // Fail-open policy shared with FailOpenThrottlerStorage/LoginAttemptService.
    it('fails open (returns false) when Redis errors', async () => {
      const redis = fakeRedis();
      redis.mget.mockRejectedValue(new Error('connection refused'));
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked(payload)).toBe(false);
    });
  });
});
