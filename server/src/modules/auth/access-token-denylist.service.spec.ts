import { describe, it, expect, vi } from "vitest";
import { AccessTokenDenylistService } from "./access-token-denylist.service";

function fakeRedis() {
  return {
    set: vi.fn().mockResolvedValue("OK"),
    exists: vi.fn().mockResolvedValue(0),
  };
}

describe("AccessTokenDenylistService", () => {
  describe("revoke", () => {
    it("sets a key with the given TTL", async () => {
      const redis = fakeRedis();
      const service = new AccessTokenDenylistService(redis as any);

      await service.revoke("jti-1", 900_000);

      expect(redis.set).toHaveBeenCalledWith("access-denylist:jti-1", "1", "PX", 900_000);
    });

    it("does nothing for a non-positive TTL", async () => {
      const redis = fakeRedis();
      const service = new AccessTokenDenylistService(redis as any);

      await service.revoke("jti-1", 0);
      await service.revoke("jti-1", -1);

      expect(redis.set).not.toHaveBeenCalled();
    });

    it("swallows a Redis error rather than throwing", async () => {
      const redis = fakeRedis();
      redis.set.mockRejectedValue(new Error("connection refused"));
      const service = new AccessTokenDenylistService(redis as any);

      await expect(service.revoke("jti-1", 900_000)).resolves.toBeUndefined();
    });
  });

  describe("isRevoked", () => {
    it("returns true when the key exists", async () => {
      const redis = fakeRedis();
      redis.exists.mockResolvedValue(1);
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked("jti-1")).toBe(true);
      expect(redis.exists).toHaveBeenCalledWith("access-denylist:jti-1");
    });

    it("returns false when the key does not exist", async () => {
      const redis = fakeRedis();
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked("jti-1")).toBe(false);
    });

    // Matches the fail-open policy used elsewhere for Redis-backed security
    // checks (FailOpenThrottlerStorage, LoginAttemptService): an outage here
    // should degrade to "revocation isn't checked" rather than break every
    // authenticated request.
    it("fails open (returns false) when Redis errors", async () => {
      const redis = fakeRedis();
      redis.exists.mockRejectedValue(new Error("connection refused"));
      const service = new AccessTokenDenylistService(redis as any);

      expect(await service.isRevoked("jti-1")).toBe(false);
    });
  });
});
