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

  function build(env: Record<string, string | undefined>) {
    return new TenantStatusService(
      redis as any,
      schoolRepo as any,
      {
        get: vi.fn((k: string) => env[k]),
      } as any,
    );
  }

  beforeEach(() => {
    redis = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn(),
    };
    schoolRepo = { findOne: vi.fn() };
    service = build({});
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

  describe('invalidate', () => {
    it('deletes the cache key so the next isActive call reloads from the DB', async () => {
      await service.invalidate('tenant-1');

      expect(redis.del).toHaveBeenCalledWith(
        'tenant:tenant-1:status',
        'tenant:tenant-1:status_reason',
      );

      redis.get.mockResolvedValue(null);
      schoolRepo.findOne.mockResolvedValue({ id: 'tenant-1', status: SchoolStatus.SUSPENDED });

      const result = await service.isActive('tenant-1');

      expect(result).toBe(false);
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('platformTenantId (TEN-19, moved from ContextGuard #620)', () => {
    it('env id wins without a DB call', async () => {
      const s = build({ PLATFORM_TENANT_ID: 'env-id' });
      expect(await s.platformTenantId()).toBe('env-id');
      expect(schoolRepo.findOne).not.toHaveBeenCalled();
    });

    it('configuredPlatformTenantId is env only, never the slug', () => {
      expect(build({ PLATFORM_TENANT_ID: 'env-id' }).configuredPlatformTenantId()).toBe('env-id');
      expect(build({ NODE_ENV: 'development' }).configuredPlatformTenantId()).toBeUndefined();
      expect(schoolRepo.findOne).not.toHaveBeenCalled();
    });

    it('trims the env value; whitespace-only counts as unset', () => {
      expect(build({ PLATFORM_TENANT_ID: ' env-id \n' }).configuredPlatformTenantId()).toBe(
        'env-id',
      );
      expect(build({ PLATFORM_TENANT_ID: '  ' }).configuredPlatformTenantId()).toBeUndefined();
    });

    it('production with no env is undefined, no DB call (fail closed)', async () => {
      const s = build({ NODE_ENV: 'production' });
      schoolRepo.findOne.mockResolvedValue({ id: 'x' });
      expect(await s.platformTenantId()).toBeUndefined();
      expect(schoolRepo.findOne).not.toHaveBeenCalled();
    });

    it('non-production finds default-school and caches the hit', async () => {
      const s = build({ NODE_ENV: 'development' });
      schoolRepo.findOne.mockResolvedValue({ id: 'dev-id' });
      expect(await s.platformTenantId()).toBe('dev-id');
      expect(await s.platformTenantId()).toBe('dev-id');
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
      expect(schoolRepo.findOne).toHaveBeenCalledWith({ where: { slug: 'default-school' } });
    });

    it('a miss is not cached', async () => {
      const s = build({ NODE_ENV: 'test' });
      schoolRepo.findOne.mockResolvedValueOnce(null);
      expect(await s.platformTenantId()).toBeUndefined();
      schoolRepo.findOne.mockResolvedValueOnce({ id: 'late-id' });
      expect(await s.platformTenantId()).toBe('late-id');
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(2);
    });
  });
});
