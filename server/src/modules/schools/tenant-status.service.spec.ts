import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { SchoolStatus } from '@biddaloy/shared';
import { TenantStatusService } from './tenant-status.service';

function invalidUuidError(): QueryFailedError {
  const err = new QueryFailedError(
    'SELECT * FROM schools WHERE id = $1',
    ['not-a-uuid'],
    new Error('invalid input syntax for type uuid: "not-a-uuid"'),
  );
  (err as unknown as { code: string }).code = '22P02';
  return err;
}

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

  describe('getStatus', () => {
    it('returns null for a nonexistent tenant, distinct from SUSPENDED', async () => {
      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue(null);

      const result = await service.getStatus('missing-tenant');

      expect(result).toBeNull();
    });

    it('returns SUSPENDED for a suspended tenant', async () => {
      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.SUSPENDED });

      const result = await service.getStatus('tenant-1');

      expect(result).toBe(SchoolStatus.SUSPENDED);
    });

    // Regression: a malformed (non-uuid) tenant id reaching the uuid-typed
    // `id` lookup raises Postgres 22P02, not a normal "no rows" miss. Only
    // ContextGuard's platform-SUPER_ADMIN cross-tenant path can reach this
    // with unvalidated input — it must see "does not exist" (null), not an
    // unhandled 500.
    it('returns null, not a thrown error, when the tenant id is not a valid uuid (Postgres 22P02)', async () => {
      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockRejectedValue(invalidUuidError());

      const result = await service.getStatus('not-a-uuid');

      expect(result).toBeNull();
    });

    it('re-throws any other DB error unchanged (not just uuid syntax errors are swallowed)', async () => {
      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockRejectedValue(new Error('connection terminated'));

      await expect(service.getStatus('tenant-1')).rejects.toThrow('connection terminated');
    });
  });

  describe('findSchoolIdBySlug', () => {
    it('returns the id of the school with the given slug', async () => {
      schoolRepo.findOne.mockResolvedValue({ id: 'school-uuid-1', slug: 'default-school' });

      const result = await service.findSchoolIdBySlug('default-school');

      expect(result).toBe('school-uuid-1');
      expect(schoolRepo.findOne).toHaveBeenCalledWith({ where: { slug: 'default-school' } });
    });

    it('returns null when no school has that slug', async () => {
      schoolRepo.findOne.mockResolvedValue(null);

      const result = await service.findSchoolIdBySlug('no-such-slug');

      expect(result).toBeNull();
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
