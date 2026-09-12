import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { RestoreService } from './restore.service';
import { WorkbookJobKind, WorkbookJobSource, WorkbookJobStatus } from '../jobs/workbook-job.entity';

describe('RestoreService', () => {
  let jobs: any;
  let schools: any;
  let queue: any;
  let staging: any;
  let exportService: any;
  let audit: any;
  let redis: any;
  let service: RestoreService;

  const TENANT = 'tenant-1';
  const USER = 'user-1';
  const STAGING_ID = 'staging-1';
  const SCHOOL_NAME = 'Greenwood High School';

  const validStage = () => ({
    hardErrorCount: 0,
    totals: { creates: 1, updates: 2, unchanged: 3, deletes: 0 },
    isEmptyTenant: false,
  });

  beforeEach(() => {
    jobs = {
      create: vi.fn((input: any) => ({ id: 'job-1', ...input })),
      save: vi.fn(async (job: any) => job),
      update: vi.fn().mockResolvedValue(undefined),
    };
    schools = {
      findOneOrFail: vi.fn(async () => ({ id: TENANT, name: SCHOOL_NAME })),
    };
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    staging = { peek: vi.fn(async () => validStage()) };
    exportService = {
      run: vi.fn(async () => ({
        id: 'snapshot-1',
        kind: WorkbookJobKind.SNAPSHOT,
        status: WorkbookJobStatus.QUEUED,
      })),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    // Simulates Redis SET NX (returns 'OK' when acquired, null when held)
    // and the compare-and-delete Lua script via `eval`.
    const store = new Map<string, string>();
    redis = {
      store,
      set: vi.fn(async (key: string, value: string) => {
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      eval: vi.fn(async (_script: string, _numKeys: number, key: string, expected: string) => {
        if (store.get(key) === expected) {
          store.delete(key);
          return 1;
        }
        return 0;
      }),
    };

    service = new RestoreService(jobs, schools, queue, staging, exportService, audit, redis);
  });

  const request = (overrides: Partial<{ confirmation: string; invite_users: boolean }> = {}) =>
    service.request(TENANT, USER, {
      staging_id: STAGING_ID,
      confirmation: overrides.confirmation ?? SCHOOL_NAME,
      invite_users: overrides.invite_users,
    });

  describe('refusals', () => {
    it('404s when the stage is unknown/expired (peek returns null); creates nothing', async () => {
      staging.peek.mockResolvedValue(null);

      await expect(request()).rejects.toBeInstanceOf(NotFoundException);

      expect(exportService.run).not.toHaveBeenCalled();
      expect(jobs.save).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('409 RESTORE_HAS_ERRORS when hardErrorCount > 0; creates nothing', async () => {
      staging.peek.mockResolvedValue({ ...validStage(), hardErrorCount: 3 });

      await expect(request()).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'RESTORE_HAS_ERRORS' }),
      });

      expect(exportService.run).not.toHaveBeenCalled();
      expect(jobs.save).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('400 CONFIRMATION_MISMATCH when confirmation does not match school name; message omits the name; creates nothing', async () => {
      let caught: any;
      try {
        await request({ confirmation: 'wrong name' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.response.code).toBe('CONFIRMATION_MISMATCH');
      expect(caught.response.message).not.toContain(SCHOOL_NAME);

      expect(exportService.run).not.toHaveBeenCalled();
      expect(jobs.save).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('409 RESTORE_IN_PROGRESS when the lock is already held; does not overwrite/delete the existing lock', async () => {
      redis.store.set('workbook:restore-lock:tenant-1', 'some-other-job');

      await expect(request()).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'RESTORE_IN_PROGRESS' }),
      });

      expect(exportService.run).not.toHaveBeenCalled();
      expect(jobs.save).not.toHaveBeenCalled();
      expect(redis.store.get('workbook:restore-lock:tenant-1')).toBe('some-other-job');
    });

    it('checks refusals in order: stage -> errors -> confirmation -> lock', async () => {
      // Stage missing wins even with a bad confirmation and a held lock.
      staging.peek.mockResolvedValue(null);
      redis.store.set('workbook:restore-lock:tenant-1', 'other');
      await expect(request({ confirmation: 'wrong' })).rejects.toBeInstanceOf(NotFoundException);

      // Errors win over confirmation/lock once the stage exists.
      staging.peek.mockResolvedValue({ ...validStage(), hardErrorCount: 1 });
      await expect(request({ confirmation: 'wrong' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'RESTORE_HAS_ERRORS' }),
      });

      // Confirmation wins over the lock once stage/errors pass.
      staging.peek.mockResolvedValue(validStage());
      await expect(request({ confirmation: 'wrong' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONFIRMATION_MISMATCH' }),
      });

      // The lock is checked only after the first three pass.
      await expect(request()).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'RESTORE_IN_PROGRESS' }),
      });
    });

    it('a second request after a refusal still finds the stage (peek, never consumed)', async () => {
      staging.peek.mockResolvedValue({ ...validStage(), hardErrorCount: 1 });
      await expect(request()).rejects.toBeDefined();

      staging.peek.mockResolvedValue(validStage());
      const result = await request();
      expect(result.job).toBeDefined();
    });
  });

  describe('lock lifecycle', () => {
    it('releases the lock when ExportService.run throws, and the request rejects', async () => {
      exportService.run.mockRejectedValue(new Error('export blew up'));

      await expect(request()).rejects.toThrow('export blew up');

      // Lock must not survive the failure.
      expect(redis.store.size).toBe(0);
    });

    it('releases the lock when jobs.save throws after the snapshot was created', async () => {
      jobs.save.mockRejectedValue(new Error('db down'));

      await expect(request()).rejects.toThrow('db down');

      expect(redis.store.size).toBe(0);
    });

    it('releases the lock when queue.add throws after the job row was created', async () => {
      queue.add.mockRejectedValue(new Error('queue down'));

      await expect(request()).rejects.toThrow('queue down');

      expect(redis.store.size).toBe(0);
    });

    it('release() with a different holder id leaves the key intact (compare-and-delete)', async () => {
      redis.store.set('workbook:restore-lock:tenant-1', 'holder-a');

      await service.release(TENANT, 'holder-b');

      expect(redis.store.get('workbook:restore-lock:tenant-1')).toBe('holder-a');
    });

    it('release() with the matching holder id removes the key', async () => {
      redis.store.set('workbook:restore-lock:tenant-1', 'holder-a');

      await service.release(TENANT, 'holder-a');

      expect(redis.store.has('workbook:restore-lock:tenant-1')).toBe(false);
    });
  });

  describe('happy path', () => {
    it('returns { job, snapshotJob }; snapshotJob comes from ExportService.run with SNAPSHOT/SNAPSHOT', async () => {
      const result = await request();

      expect(exportService.run).toHaveBeenCalledWith(TENANT, {
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        requestedByUserId: USER,
      });
      expect(result.snapshotJob.id).toBe('snapshot-1');
      expect(result.job).toBeDefined();
    });

    it('acquires the lock with NX EX 3600, and the stored lock value equals the restore job id', async () => {
      const result = await request();

      expect(redis.set).toHaveBeenCalledWith(
        'workbook:restore-lock:tenant-1',
        result.job.id,
        'EX',
        3600,
        'NX',
      );
      // The lock token IS the job id — this is what 14.10.2's processor
      // releases with, so a mismatch would leave the lock stuck forever.
      expect(redis.store.get('workbook:restore-lock:tenant-1')).toBe(result.job.id);
    });

    it('persists a WorkbookJob with kind RESTORE, status QUEUED, and correct linkage', async () => {
      const result = await request();

      const created = jobs.create.mock.calls[0][0];
      expect(created.kind).toBe(WorkbookJobKind.RESTORE);
      expect(created.status).toBe(WorkbookJobStatus.QUEUED);
      expect(created.tenant_id).toBe(TENANT);
      expect(created.requested_by_user_id).toBe(USER);
      expect(created.staging_id).toBe(STAGING_ID);
      expect(created.snapshot_job_id).toBe(result.snapshotJob.id);
    });

    it('creates the snapshot job before the restore row', async () => {
      const order: string[] = [];
      exportService.run.mockImplementation(async () => {
        order.push('snapshot');
        return {
          id: 'snapshot-1',
          kind: WorkbookJobKind.SNAPSHOT,
          status: WorkbookJobStatus.QUEUED,
        };
      });
      jobs.save.mockImplementation(async (job: any) => {
        order.push('restore-row');
        return job;
      });

      await request();

      expect(order).toEqual(['snapshot', 'restore-row']);
    });

    it('enqueues on the restore queue with { jobId, inviteUsers } and attempts: 1', async () => {
      const result = await request({ invite_users: true });

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = queue.add.mock.calls[0];
      expect(name).toBe('restore');
      expect(data).toEqual({ jobId: result.job.id, inviteUsers: true });
      expect(opts).toMatchObject({ attempts: 1 });
    });

    it('does not consume the stage — a second request after success still finds it', async () => {
      await request();
      expect(staging.peek).toHaveBeenCalled();
      // peek, never consume: no `consume` method is even wired up on the mock.
      expect(staging.consume).toBeUndefined();
    });
  });

  describe('audit', () => {
    it('writes one RESTORE_REQUESTED audit record with the expected shape', async () => {
      const result = await request();

      expect(audit.record).toHaveBeenCalledTimes(1);
      const entry = audit.record.mock.calls[0][0];
      expect(entry.action).toBe('CREATE');
      expect(entry.entity_type).toBe('School');
      expect(entry.entity_id).toBe(result.job.id);
      expect(entry.tenant_id).toBe(TENANT);
      expect(entry.performed_by_user_id).toBe(USER);
      expect(entry.new_values).toEqual({
        event: 'RESTORE_REQUESTED',
        workbook_job_id: result.job.id,
        staging_id: STAGING_ID,
        snapshot_job_id: result.snapshotJob.id,
        totals: validStage().totals,
      });
    });

    it('does not fail the request when the audit write throws', async () => {
      audit.record.mockRejectedValue(new Error('audit db down'));

      const result = await request();

      expect(result.job).toBeDefined();
    });

    it('writes no audit record on any refusal path', async () => {
      staging.peek.mockResolvedValue(null);
      await expect(request()).rejects.toBeDefined();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
