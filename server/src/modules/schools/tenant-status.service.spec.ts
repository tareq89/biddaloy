import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchoolStatus } from '@biddaloy/shared';
import { TenantStatusService } from './tenant-status.service';

describe('TenantStatusService', () => {
  let redis: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let schoolRepo: { findOne: ReturnType<typeof vi.fn> };
  let service: TenantStatusService;

  beforeEach(() => {
    redis = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };
    schoolRepo = { findOne: vi.fn() };
    service = new TenantStatusService(redis as any, schoolRepo as any);
  });

  describe('isActive', () => {
    it('returns true and caches on a cache miss for an ACTIVE tenant', async () => {
      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.ACTIVE });

      const result = await service.isActive('tenant-1');

      expect(result).toBe(true);
      expect(schoolRepo.findOne).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
      expect(redis.set).toHaveBeenCalledWith(
        'tenant:tenant-1:status',
        SchoolStatus.ACTIVE,
        'EX',
        300,
      );
    });

    it('returns false for a SUSPENDED tenant on a cache miss', async () => {
      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.SUSPENDED });

      const result = await service.isActive('tenant-1');

      expect(result).toBe(false);
      expect(redis.set).toHaveBeenCalledWith(
        'tenant:tenant-1:status',
        SchoolStatus.SUSPENDED,
        'EX',
        300,
      );
    });

    it('does not hit the DB again on a second call within the TTL (cache hit)', async () => {
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(SchoolStatus.ACTIVE);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.ACTIVE });

      const first = await service.isActive('tenant-1');
      const second = await service.isActive('tenant-1');

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('falls back to the DB (fails open on the cache) when Redis read errors', async () => {
      redis.get.mockRejectedValue(new Error('connection refused'));
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.ACTIVE });

      const result = await service.isActive('tenant-1');

      expect(result).toBe(true);
      expect(schoolRepo.findOne).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
    });

    it('treats a missing school as not active', async () => {
      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue(null);

      const result = await service.isActive('missing-tenant');

      expect(result).toBe(false);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('invalidate', () => {
    it('deletes the cache key so the next isActive call reloads from the DB', async () => {
      await service.invalidate('tenant-1');

      expect(redis.del).toHaveBeenCalledWith('tenant:tenant-1:status');

      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.SUSPENDED });

      const result = await service.isActive('tenant-1');

      expect(result).toBe(false);
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });
});
