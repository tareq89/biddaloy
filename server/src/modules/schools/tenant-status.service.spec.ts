import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { SchoolStatus } from '@biddaloy/shared';
import * as Sentry from '@sentry/node';
import { TenantStatusService } from './tenant-status.service';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

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
    exists: ReturnType<typeof vi.fn>;
  };
  let schoolRepo: { findOne: ReturnType<typeof vi.fn> };
  let service: TenantStatusService;

  beforeEach(() => {
    redis = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn(),
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

  describe('getStatusReason', () => {
    it('reads the DB once, then serves the cached reason', async () => {
      redis.get.mockResolvedValueOnce(null);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status_reason: 'TRIAL_EXPIRED' });

      expect(await service.getStatusReason('tenant-1')).toBe('TRIAL_EXPIRED');
      expect(redis.set).toHaveBeenCalledWith(
        'tenant:tenant-1:status_reason',
        'TRIAL_EXPIRED',
        'EX',
        300,
      );

      redis.get.mockResolvedValueOnce('TRIAL_EXPIRED');
      expect(await service.getStatusReason('tenant-1')).toBe('TRIAL_EXPIRED');
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('caches "no reason" as an empty string and returns null for it', async () => {
      redis.get.mockResolvedValueOnce('');
      expect(await service.getStatusReason('tenant-1')).toBeNull();
      expect(schoolRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('isRestoring (#2210)', () => {
    it('is true when the restore lock key exists', async () => {
      redis.exists.mockResolvedValue(1);

      expect(await service.isRestoring('tenant-1')).toBe(true);
      expect(redis.exists).toHaveBeenCalledWith('workbook:restore-lock:tenant-1');
    });

    it('is false when the key is absent', async () => {
      redis.exists.mockResolvedValue(0);

      expect(await service.isRestoring('tenant-1')).toBe(false);
    });

    it('is false (does not throw) when Redis rejects', async () => {
      redis.exists.mockRejectedValue(new Error('connection refused'));

      expect(await service.isRestoring('tenant-1')).toBe(false);
    });

    it('is true when Redis rejects and the caller asked to fail closed (schedulers, workers)', async () => {
      redis.exists.mockRejectedValue(new Error('connection refused'));

      expect(await service.isRestoring('tenant-1', { failClosed: true })).toBe(true);
    });

    // Fail-open lets writes back in if Redis drops mid-restore, so it must show up in Sentry —
    // but only once per window, since a Redis outage fails every write request.
    it('reports a failed lock read to Sentry once, not once per request', async () => {
      vi.mocked(Sentry.captureException).mockClear();
      redis.exists.mockRejectedValue(new Error('connection refused'));

      await service.isRestoring('tenant-1');
      await service.isRestoring('tenant-1');

      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReadOnlyUntil (seat grace, D9)', () => {
    const until = '2027-01-08T00:00:00.000Z';

    beforeEach(() => {
      (schoolRepo as any).query = vi.fn();
    });

    it('returns the cached date without touching the DB', async () => {
      redis.get.mockResolvedValue(until);
      expect(await service.getReadOnlyUntil('t1')).toEqual(new Date(until));
      expect(redis.get).toHaveBeenCalledWith('tenant:t1:read_only_until');
      expect((schoolRepo as any).query).not.toHaveBeenCalled();
    });

    it("treats a cached '' as not read-only, without a DB call", async () => {
      redis.get.mockResolvedValue('');
      expect(await service.getReadOnlyUntil('t1')).toBeNull();
      expect((schoolRepo as any).query).not.toHaveBeenCalled();
    });

    it('on a miss reads the DB and caches the answer for the status TTL', async () => {
      redis.get.mockResolvedValue(null);
      // Over its seats, last paid period ended 2027-01-01 (school-local) -> until 2027-01-08 00:00 +06.
      (schoolRepo as any).query.mockResolvedValue([{ over: true, anchor: '2027-01-01' }]);
      const res = await service.getReadOnlyUntil('t1');
      expect(res).toEqual(new Date('2027-01-07T18:00:00.000Z'));
      expect(redis.set).toHaveBeenCalledWith(
        'tenant:t1:read_only_until',
        '2027-01-07T18:00:00.000Z',
        'EX',
        300,
      );
    });

    it('caches an empty string when the school is not over its seats', async () => {
      redis.get.mockResolvedValue(null);
      (schoolRepo as any).query.mockResolvedValue([{ over: false, anchor: null }]);
      expect(await service.getReadOnlyUntil('t1')).toBeNull();
      expect(redis.set).toHaveBeenCalledWith('tenant:t1:read_only_until', '', 'EX', 300);
    });

    it('fails open when Redis and the DB both fail (a write is not blocked by an outage)', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      (schoolRepo as any).query.mockRejectedValue(new Error('db down'));
      expect(await service.getReadOnlyUntil('t1')).toBeNull();
    });

    it('still answers from the DB when only Redis is down', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      redis.set.mockRejectedValue(new Error('redis down'));
      (schoolRepo as any).query.mockResolvedValue([{ over: true, anchor: '2027-01-01' }]);
      expect(await service.getReadOnlyUntil('t1')).toEqual(new Date('2027-01-07T18:00:00.000Z'));
    });
  });

  describe('invalidate', () => {
    it('deletes the cache key so the next isActive call reloads from the DB', async () => {
      await service.invalidate('tenant-1');

      expect(redis.del).toHaveBeenCalledWith(
        'tenant:tenant-1:status',
        'tenant:tenant-1:status_reason',
        'tenant:tenant-1:read_only_until',
      );

      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.SUSPENDED });

      const result = await service.isActive('tenant-1');

      expect(result).toBe(false);
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('platformTenantId (Epic 98: the is_platform home row only)', () => {
    it('returns the flagged school id, never an env value or a slug match', async () => {
      schoolRepo.findOne.mockResolvedValue({ id: 'home-id' });
      expect(await service.platformTenantId()).toBe('home-id');
      expect(schoolRepo.findOne).toHaveBeenCalledWith({ where: { is_platform: true } });
    });

    it('caches a hit', async () => {
      schoolRepo.findOne.mockResolvedValue({ id: 'home-id' });
      await service.platformTenantId();
      await service.platformTenantId();
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('does not cache a miss, so a late-created home row is found', async () => {
      schoolRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'home-id' });
      expect(await service.platformTenantId()).toBeUndefined();
      expect(await service.platformTenantId()).toBe('home-id');
    });

    it('platformSchoolIds is the one home id, or empty', async () => {
      schoolRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'home-id' });
      expect(await service.platformSchoolIds()).toEqual([]);
      expect(await service.platformSchoolIds()).toEqual(['home-id']);
    });
  });
});
