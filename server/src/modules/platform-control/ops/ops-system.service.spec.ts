import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import {
  LIVE_LOCK_MIN_TTL_SEC,
  OpsSystemService,
  RELEASED_BY_OWNER,
  restoreLockKey,
} from './ops-system.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';

describe('OpsSystemService', () => {
  const m = { query: vi.fn() };
  const ds = {
    query: vi.fn(),
    transaction: vi.fn(async (fn: (mgr: typeof m) => unknown) => fn(m)),
  };
  const redis = { ttl: vi.fn(), del: vi.fn(), exists: vi.fn(), eval: vi.fn() };
  const health = { probeRedis: vi.fn() };
  const tenantStatus = { invalidate: vi.fn() };
  const audit = { recordApproved: vi.fn() };
  let svc: OpsSystemService;
  const savedVersion = process.env.APP_VERSION;

  beforeEach(() => {
    vi.clearAllMocks();
    redis.ttl.mockResolvedValue(100);
    redis.del.mockResolvedValue(1);
    redis.exists.mockResolvedValue(1);
    redis.eval.mockResolvedValue(1);
    health.probeRedis.mockResolvedValue('ok');
    tenantStatus.invalidate.mockResolvedValue(undefined);
    audit.recordApproved.mockResolvedValue(undefined);
    svc = new OpsSystemService(
      ds as never,
      redis as never,
      health as never,
      tenantStatus as never,
      audit as never,
    );
  });
  afterEach(() => {
    if (savedVersion === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = savedVersion;
  });

  describe('getSystem', () => {
    it('falls back to unknown version and maps probes without any error text', async () => {
      delete process.env.APP_VERSION;
      ds.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT 1')) throw new Error('connect ECONNREFUSED db.internal:5432');
        if (sql.includes('typeorm_migrations')) return [{ name: 'Mig123' }];
        return [];
      });
      health.probeRedis.mockResolvedValue('fail');
      const out = await svc.getSystem();
      expect(out).toEqual({
        appVersion: 'unknown',
        lastMigration: 'Mig123',
        database: 'fail',
        redis: 'fail',
        restoring: [],
      });
      expect(JSON.stringify(out)).not.toMatch(/ECONNREFUSED|db\.internal/);
    });

    it('reports the env version, ok probes, and restoring schools with lock state', async () => {
      process.env.APP_VERSION = '1.2.3';
      ds.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT 1')) return [{}];
        if (sql.includes('typeorm_migrations')) return [];
        return [{ tenant_id: SCHOOL, name: 'A School', status: 'RUNNING' }];
      });
      const out = await svc.getSystem();
      expect(out.appVersion).toBe('1.2.3');
      expect(out.lastMigration).toBeNull();
      expect(out.database).toBe('ok');
      expect(out.restoring).toEqual([
        { schoolId: SCHOOL, schoolName: 'A School', jobStatus: 'RUNNING', locked: true },
      ]);
    });
  });

  describe('releaseRestoreLock', () => {
    const jobRow = {
      id: JOB,
      status: 'RUNNING',
      progress: { tab: 'students' },
      snapshot_job_id: 'snap',
    };

    it('unknown school is 404, no echo, nothing touched', async () => {
      ds.query.mockResolvedValue([]);
      const err = await svc.releaseRestoreLock(SCHOOL, OWNER).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(JSON.stringify(err.getResponse())).not.toContain(SCHOOL);
      expect(redis.ttl).not.toHaveBeenCalled();
      expect(audit.recordApproved).not.toHaveBeenCalled();
    });

    it('a live lock (fresh TTL) is 409 RESTORE_RUNNING and nothing changes', async () => {
      ds.query.mockResolvedValue([{}]);
      redis.ttl.mockResolvedValue(LIVE_LOCK_MIN_TTL_SEC + 1);
      const err = await svc.releaseRestoreLock(SCHOOL, OWNER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().code).toBe('RESTORE_RUNNING');
      expect(ds.transaction).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('stale lock: fails the running job, audits in the same tx, CAS-releases, invalidates', async () => {
      ds.query.mockResolvedValue([{}]);
      m.query.mockResolvedValueOnce([jobRow]).mockResolvedValueOnce([[{ id: JOB }], 1]);
      const out = await svc.releaseRestoreLock(SCHOOL, OWNER);
      expect(out).toEqual({ released: true, failedJobs: 1 });
      const [sql, params] = m.query.mock.calls[1];
      expect(sql).toContain("status IN ('QUEUED', 'RUNNING')"); // conditional update
      expect(params).toEqual([RELEASED_BY_OWNER, 'students', JOB]);
      expect(audit.recordApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PLATFORM_RESTORE_LOCK_RELEASED,
          tenant_id: SCHOOL,
          approved_by_user_id: OWNER,
          approval_scope: ApprovalScope.PLATFORM_OPS_ACTION,
          new_values: expect.objectContaining({
            jobs: [
              {
                workbook_job_id: JOB,
                previous_status: 'RUNNING',
                failed_tab: 'students',
                snapshot_job_id: 'snap',
              },
            ],
          }),
        }),
        m, // same transaction as the job update
      );
      // compare-and-delete with the job id, never a blind DEL
      expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, restoreLockKey(SCHOOL), JOB);
      expect(redis.del).not.toHaveBeenCalled();
      expect(tenantStatus.invalidate).toHaveBeenCalledWith(SCHOOL);
    });

    it('a job a worker finished meanwhile is not overwritten and its lock is not touched', async () => {
      ds.query.mockResolvedValue([{}]);
      m.query.mockResolvedValueOnce([jobRow]).mockResolvedValueOnce([[], 0]);
      const out = await svc.releaseRestoreLock(SCHOOL, OWNER);
      expect(out).toEqual({ released: false, failedJobs: 0 });
      expect(redis.eval).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('orphan lock (no unfinished job) is deleted blind and audited', async () => {
      ds.query.mockResolvedValue([{}]);
      m.query.mockResolvedValueOnce([]);
      const out = await svc.releaseRestoreLock(SCHOOL, OWNER);
      expect(out).toEqual({ released: true, failedJobs: 0 });
      expect(redis.del).toHaveBeenCalledWith(restoreLockKey(SCHOOL));
      expect(audit.recordApproved).toHaveBeenCalledTimes(1);
    });

    it('audit failure fails the request and releases no lock (never fail-open)', async () => {
      ds.query.mockResolvedValue([{}]);
      m.query.mockResolvedValueOnce([jobRow]).mockResolvedValueOnce([[{ id: JOB }], 1]);
      audit.recordApproved.mockRejectedValue(new Error('db down'));
      await expect(svc.releaseRestoreLock(SCHOOL, OWNER)).rejects.toThrow('db down');
      expect(redis.eval).not.toHaveBeenCalled();
      expect(tenantStatus.invalidate).not.toHaveBeenCalled();
    });
  });
});
