import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PayloadTooLargeException } from '@nestjs/common';
import { ImportStagingService, DEFAULT_STAGING_TTL_SEC } from './import-staging.service';

function fakeRedis() {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null),
  };
}

describe('ImportStagingService', () => {
  describe('stage', () => {
    it('writes bulk-import:<tenant>:<user>:<uuid> with EX and the default TTL, returning a matching expiresAt', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const result = await service.stage('tenant-1', 'user-1', { rows: 1 });

      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value, exFlag, ttl] = redis.set.mock.calls[0];
      expect(key).toMatch(/^bulk-import:tenant-1:user-1:[0-9a-f-]{36}$/);
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(DEFAULT_STAGING_TTL_SEC);
      expect(JSON.parse(value)).toMatchObject({ userId: 'user-1', payload: { rows: 1 } });

      expect(result.stagingId).toBe(key.split(':')[3]);
      expect(result.expiresAt).toBe(
        new Date(Date.now() + DEFAULT_STAGING_TTL_SEC * 1000).toISOString(),
      );

      vi.useRealTimers();
    });

    it('forwards a custom ttlSec to SET verbatim', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      await service.stage('tenant-1', 'user-1', { rows: 1 }, 60);

      expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 60);
    });

    it('rejects a payload serialising over 20 MB with PayloadTooLargeException, without calling set', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);
      const huge = 'x'.repeat(21 * 1024 * 1024);

      await expect(service.stage('tenant-1', 'user-1', { huge })).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('peek', () => {
    it('round-trips a staged payload', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const { stagingId } = await service.stage('tenant-1', 'user-1', { rows: 3 });
      const stored = redis.set.mock.calls[0][1];
      redis.get.mockResolvedValue(stored);

      const result = await service.peek('tenant-1', 'user-1', stagingId);

      expect(result).toEqual({ rows: 3 });
    });

    it('returns null for a wrong tenant (reads the tenant-scoped key, which misses)', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const { stagingId } = await service.stage('tenant-a', 'user-1', { rows: 3 });
      redis.get.mockResolvedValue(null); // tenant-b key was never written

      const result = await service.peek('tenant-b', 'user-1', stagingId);

      expect(redis.get).toHaveBeenCalledWith(`bulk-import:tenant-b:user-1:${stagingId}`);
      expect(result).toBeNull();
    });

    // The key itself is scoped by userId, so a different user reads an
    // entirely different (never-written) key rather than the real one.
    it('returns null for a different user (reads the user-scoped key, which misses)', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const { stagingId } = await service.stage('tenant-1', 'user-1', { rows: 3 });
      redis.get.mockResolvedValue(null); // user-2's key was never written

      const result = await service.peek('tenant-1', 'user-2', stagingId);

      expect(redis.get).toHaveBeenCalledWith(`bulk-import:tenant-1:user-2:${stagingId}`);
      expect(result).toBeNull();
    });

    // Defence in depth: even if a caller's key somehow matched (e.g. a
    // future refactor removes userId from the key), the envelope check
    // alone must still reject it.
    it('returns null when the stored userId differs, even though the key matched', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const { stagingId } = await service.stage('tenant-1', 'user-1', { rows: 3 });
      redis.get.mockResolvedValue(redis.set.mock.calls[0][1]);

      const result = await service.peek('tenant-1', 'user-2', stagingId);

      expect(result).toBeNull();
    });

    it('returns null instead of throwing for malformed stored JSON', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);
      redis.get.mockResolvedValue('{not valid json');

      const result = await service.peek('tenant-1', 'user-1', 'some-id');

      expect(result).toBeNull();
    });

    it('returns null instead of throwing for valid JSON that is not an object (e.g. `null`)', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);
      redis.get.mockResolvedValue('null');

      const result = await service.peek('tenant-1', 'user-1', 'some-id');

      expect(result).toBeNull();
    });
  });

  describe('consume', () => {
    it('uses getdel (not get) and returns the payload; a second consume returns null', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const { stagingId } = await service.stage('tenant-1', 'user-1', { rows: 5 });
      const stored = redis.set.mock.calls[0][1];
      redis.getdel.mockResolvedValueOnce(stored).mockResolvedValueOnce(null);

      const first = await service.consume('tenant-1', 'user-1', stagingId);
      const second = await service.consume('tenant-1', 'user-1', stagingId);

      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.getdel).toHaveBeenCalledWith(`bulk-import:tenant-1:user-1:${stagingId}`);
      expect(first).toEqual({ rows: 5 });
      expect(second).toBeNull();
    });

    it('returns null when the stored userId differs', async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const { stagingId } = await service.stage('tenant-1', 'user-1', { rows: 5 });
      redis.getdel.mockResolvedValue(redis.set.mock.calls[0][1]);

      const result = await service.consume('tenant-1', 'user-2', stagingId);

      expect(result).toBeNull();
    });

    // Regression test for the authorization-bypass finding: a same-tenant
    // caller who guessed or leaked another user's stagingId must not be able
    // to *delete* that user's stage, even though they can't read it. With the
    // key itself scoped by userId, the attacker's GETDEL hits a key that was
    // never written, so the real owner's key is left completely untouched —
    // and the owner can still consume it afterwards.
    it("does not delete the real owner's stage when a different user attempts to consume it", async () => {
      const redis = fakeRedis();
      const service = new ImportStagingService(redis as any);

      const { stagingId } = await service.stage('tenant-1', 'user-1', { rows: 5 });
      const stored = redis.set.mock.calls[0][1];
      // user-2's key was never written, so their GETDEL misses.
      redis.getdel.mockResolvedValueOnce(null);

      const attackerResult = await service.consume('tenant-1', 'user-2', stagingId);

      expect(attackerResult).toBeNull();
      expect(redis.getdel).toHaveBeenCalledWith(`bulk-import:tenant-1:user-2:${stagingId}`);
      expect(redis.getdel).not.toHaveBeenCalledWith(`bulk-import:tenant-1:user-1:${stagingId}`);

      // The real owner's key was never touched, so they can still consume it.
      redis.getdel.mockResolvedValueOnce(stored);
      const ownerResult = await service.consume('tenant-1', 'user-1', stagingId);

      expect(ownerResult).toEqual({ rows: 5 });
    });
  });
});
