import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { RestoreProcessor } from './restore.processor';
import { ALL_TABS } from '../codec/registry';
import { WorkbookJobKind, WorkbookJobSource, WorkbookJobStatus } from '../jobs/workbook-job.entity';

/** First five tabs in `ALL_TABS`/`EXPECTED_TABS` order — used to build a
 * small, controlled `ValidatedWorkbook` without touching the other 13
 * (fees/people) tabs' real entities. */
const [SCHOOL, ACADEMIC_YEARS, CLASSES, SECTIONS, SUBJECTS] = ALL_TABS.map((t) => t.name);

function makeValidatedWorkbook(tabRows: Record<string, unknown[]>) {
  const tabs: Record<string, any> = {};
  for (const tab of ALL_TABS) {
    const rows = tabRows[tab.name];
    tabs[tab.name] = rows
      ? { present: true, rows, errors: [], warnings: [] }
      : { present: false, rows: [], errors: [], warnings: [] };
  }
  return {
    meta: {
      schema_version: 1,
      kind: 'BACKUP',
      exported_at: 'x',
      source_school_name: 's',
      source_school_slug: 's',
    },
    tabs,
    errors: [],
    warnings: [],
    hardErrorCount: 0,
  };
}

describe('RestoreProcessor', () => {
  let jobs: any;
  let dataSource: any;
  let storage: any;
  let staging: any;
  let validationService: any;
  let invitations: any;
  let audit: any;
  let events: any;
  let restoreService: any;
  let processor: RestoreProcessor;
  let jobRow: any;
  let snapshotRow: any;

  const TENANT = 'tenant-1';
  const USER = 'user-1';

  beforeEach(() => {
    vi.useFakeTimers();

    jobRow = {
      id: 'job-1',
      tenant_id: TENANT,
      kind: WorkbookJobKind.RESTORE,
      source: WorkbookJobSource.MANUAL,
      status: WorkbookJobStatus.QUEUED,
      requested_by_user_id: USER,
      staging_id: 'staging-1',
      snapshot_job_id: 'snapshot-1',
      storage_key: null,
      size_bytes: null,
    };
    snapshotRow = { id: 'snapshot-1', status: WorkbookJobStatus.DONE };

    jobs = {
      findOne: vi.fn(async ({ where: { id } }: any) => {
        if (id === jobRow.id) return jobRow;
        if (id === snapshotRow.id) return snapshotRow;
        return null;
      }),
      update: vi.fn(async (id: string, patch: any) => {
        if (id === jobRow.id) Object.assign(jobRow, patch);
      }),
    };

    dataSource = {
      manager: {},
      // The processor writes the terminal status update through
      // `m.getRepository(WorkbookJob).update(...)` inside the transaction
      // callback — route that at the same `jobs.update` mock so tests can
      // assert on `jobRow` the same way they do outside a transaction.
      transaction: vi.fn(async (cb: any) => cb({ getRepository: () => ({ update: jobs.update }) })),
    };

    storage = {
      get: vi.fn(async () => ({
        body: (async function* () {
          yield Buffer.from('fake-xlsx-bytes');
        })(),
      })),
    };

    staging = {
      consume: vi.fn(async () => ({
        workbook_storage_key: 'workbook-key-1',
        meta: {},
        tabs: [],
        totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
        hardErrorCount: 0,
        isEmptyTenant: false,
        errors: [],
        warnings: [],
      })),
    };

    validationService = { validate: vi.fn() };
    invitations = { issueAndSend: vi.fn().mockResolvedValue({ status: 'SENT' }) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    events = { emitFinished: vi.fn() };
    restoreService = {
      release: vi.fn().mockResolvedValue(undefined),
      renewLock: vi.fn().mockResolvedValue(true),
    };

    processor = new RestoreProcessor(
      jobs,
      dataSource,
      storage,
      staging,
      validationService,
      invitations,
      audit,
      events,
      restoreService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function run() {
    return processor.process({ data: { jobId: jobRow.id, inviteUsers: false } } as any);
  }

  describe('waiting for the snapshot (#693 seam guard)', () => {
    it('proceeds once the snapshot job reaches DONE', async () => {
      validationService.validate.mockResolvedValue(makeValidatedWorkbook({}));
      await run();
      expect(jobRow.status).toBe(WorkbookJobStatus.DONE);
    });

    it('fails the restore with SNAPSHOT_FAILED when the snapshot job is FAILED, without touching any tab', async () => {
      snapshotRow.status = WorkbookJobStatus.FAILED;
      await run();
      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      expect(jobRow.error).toBe('SNAPSHOT_FAILED');
      expect(jobRow.failed_tab).toBeNull();
      expect(validationService.validate).not.toHaveBeenCalled();
      // No tab was touched, but `terminate` now writes the FAILED status
      // and its audit row atomically in one transaction.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(restoreService.release).toHaveBeenCalledWith(TENANT, jobRow.id);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: expect.objectContaining({ event: 'RESTORE_FAILED' }),
        }),

        expect.anything(),
      );
    });

    it('fails the restore with SNAPSHOT_FAILED after polling times out', async () => {
      snapshotRow.status = WorkbookJobStatus.RUNNING;
      const promise = run();
      // Advance past the 10-minute cap in 2s steps (the poll interval).
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 5000);
      await promise;
      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      expect(jobRow.error).toBe('SNAPSHOT_FAILED');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('the #693 seam: stage -> consume -> download -> validate', () => {
    it('consumes the stage, downloads the storage buffer, and re-validates it for real typed rows', async () => {
      validationService.validate.mockResolvedValue(makeValidatedWorkbook({}));
      await run();

      expect(staging.consume).toHaveBeenCalledWith(TENANT, USER, 'staging-1');
      expect(storage.get).toHaveBeenCalledWith('workbook-key-1');
      expect(validationService.validate).toHaveBeenCalledWith(
        Buffer.from('fake-xlsx-bytes'),
        TENANT,
        dataSource.manager,
      );
    });

    it('fails the restore if the stage was already consumed (returns null)', async () => {
      staging.consume.mockResolvedValue(null);
      await run();
      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      expect(jobRow.error).toMatch(/staged import/i);
    });

    it('aborts before touching any tab when re-validation finds hard errors', async () => {
      // A row that fails re-validation is simply absent from `rows` — if we
      // proceeded, `deleteByAbsence` would read that absence as "the user
      // deleted this row" and delete its live counterpart for real. Never
      // apply a workbook that failed to re-validate cleanly.
      const workbook = makeValidatedWorkbook({ [SCHOOL]: [{ name: 'Test School' }] });
      workbook.hardErrorCount = 1;
      validationService.validate.mockResolvedValue(workbook);
      const upsertSpy = vi.spyOn(ALL_TABS[0], 'upsert');

      await run();

      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      expect(jobRow.error).toMatch(/re-validation found 1 error/i);
      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });

  describe('applying tabs in order', () => {
    it('upserts rows tab by tab, tracks per-tab row counts, and finishes DONE', async () => {
      const schoolEntity = { id: 'school-entity-1' };
      const yearEntity = { id: 'year-entity-1' };

      vi.spyOn(ALL_TABS[0], 'load').mockResolvedValue([]);
      vi.spyOn(ALL_TABS[0], 'keyOf').mockReturnValue('school-key');
      vi.spyOn(ALL_TABS[0], 'upsert').mockResolvedValue(schoolEntity as any);
      vi.spyOn(ALL_TABS[0], 'deleteByAbsence', 'get').mockReturnValue(false);

      vi.spyOn(ALL_TABS[1], 'load').mockResolvedValue([]);
      vi.spyOn(ALL_TABS[1], 'keyOf').mockReturnValue('year-key');
      vi.spyOn(ALL_TABS[1], 'upsert').mockResolvedValue(yearEntity as any);
      vi.spyOn(ALL_TABS[1], 'deleteByAbsence', 'get').mockReturnValue(false);

      validationService.validate.mockResolvedValue(
        makeValidatedWorkbook({
          [SCHOOL]: [{ name: 'Test School' }],
          [ACADEMIC_YEARS]: [{ label: '2026' }],
        }),
      );

      await run();

      expect(jobRow.status).toBe(WorkbookJobStatus.DONE);
      expect(jobRow.row_counts).toEqual({ [SCHOOL]: 1, [ACADEMIC_YEARS]: 1 });
      expect(jobRow.finished_at).toBeInstanceOf(Date);
      // 2 per-tab transactions + the terminal DONE-status/audit transaction.
      expect(dataSource.transaction).toHaveBeenCalledTimes(3);
      expect(restoreService.release).toHaveBeenCalledWith(TENANT, jobRow.id);
      expect(events.emitFinished).toHaveBeenCalledWith(
        expect.objectContaining({
          status: WorkbookJobStatus.DONE,
          rowCounts: { [SCHOOL]: 1, [ACADEMIC_YEARS]: 1 },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: expect.objectContaining({ event: 'RESTORE_COMPLETED' }),
        }),

        expect.anything(),
      );
    });

    it('skips a tab whose sheet is not present in the workbook', async () => {
      const loadSpy = vi.spyOn(ALL_TABS[0], 'load');
      validationService.validate.mockResolvedValue(makeValidatedWorkbook({}));

      await run();

      expect(loadSpy).not.toHaveBeenCalled();
      // No tab ran, but the terminal DONE-status/audit write still does.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(jobRow.status).toBe(WorkbookJobStatus.DONE);
      expect(jobRow.row_counts).toEqual({});
    });

    it('deletes existing rows absent from the workbook when deleteByAbsence is set', async () => {
      const keep = { id: 'keep-1' };
      const drop = { id: 'drop-1' };

      vi.spyOn(ALL_TABS[0], 'load').mockResolvedValue([keep, drop] as any);
      vi.spyOn(ALL_TABS[0], 'keyOf').mockImplementation((x: any) =>
        x === keep || x?.id === keep.id ? 'keep-key' : 'row-key',
      );
      vi.spyOn(ALL_TABS[0], 'upsert').mockResolvedValue(keep as any);
      vi.spyOn(ALL_TABS[0], 'deleteByAbsence', 'get').mockReturnValue(true);
      const removeSpy = vi.spyOn(ALL_TABS[0], 'remove').mockResolvedValue(undefined);

      validationService.validate.mockResolvedValue(
        makeValidatedWorkbook({ [SCHOOL]: [{ name: 'kept row' }] }),
      );

      await run();

      expect(removeSpy).toHaveBeenCalledWith(drop, expect.anything());
      expect(removeSpy).not.toHaveBeenCalledWith(keep, expect.anything());
      expect(jobRow.status).toBe(WorkbookJobStatus.DONE);
    });

    it('resolves a pending:<tab>:<key> placeholder to the real id inserted earlier in the same restore', async () => {
      const yearEntity = { id: 'year-real-id' };
      const classEntity = { id: 'class-1', academic_year_id: null as string | null };

      vi.spyOn(ALL_TABS[1], 'load').mockResolvedValue([]); // academic_years
      vi.spyOn(ALL_TABS[1], 'keyOf').mockReturnValue('2026');
      vi.spyOn(ALL_TABS[1], 'upsert').mockResolvedValue(yearEntity as any);
      vi.spyOn(ALL_TABS[1], 'deleteByAbsence', 'get').mockReturnValue(false);

      vi.spyOn(ALL_TABS[2], 'load').mockResolvedValue([]); // classes
      vi.spyOn(ALL_TABS[2], 'keyOf').mockReturnValue('class-key');
      vi.spyOn(ALL_TABS[2], 'upsert').mockImplementation(async (row: any) => {
        classEntity.academic_year_id = row.academic_year_id;
        return classEntity as any;
      });
      vi.spyOn(ALL_TABS[2], 'deleteByAbsence', 'get').mockReturnValue(false);

      validationService.validate.mockResolvedValue(
        makeValidatedWorkbook({
          [ACADEMIC_YEARS]: [{ label: '2026' }],
          [CLASSES]: [{ name: 'Six', academic_year_id: `pending:${ACADEMIC_YEARS}:2026` }],
        }),
      );

      await run();

      expect(classEntity.academic_year_id).toBe('year-real-id');
      expect(jobRow.status).toBe(WorkbookJobStatus.DONE);
    });
  });

  describe('tab failure (D8: earlier tabs stay committed)', () => {
    it('fails the job on the 5th tab and keeps the first four tabs applied, releasing the lock', async () => {
      const names = [SCHOOL, ACADEMIC_YEARS, CLASSES, SECTIONS, SUBJECTS];
      names.forEach((_, i) => {
        vi.spyOn(ALL_TABS[i], 'load').mockResolvedValue([]);
        vi.spyOn(ALL_TABS[i], 'keyOf').mockReturnValue(`key-${i}`);
        vi.spyOn(ALL_TABS[i], 'deleteByAbsence', 'get').mockReturnValue(false);
      });
      for (let i = 0; i < 4; i++) {
        vi.spyOn(ALL_TABS[i], 'upsert').mockResolvedValue({ id: `entity-${i}` } as any);
      }
      const pgError = new QueryFailedError('insert', [], new Error('duplicate key') as any);
      (pgError as any).code = '23505';
      (pgError as any).constraint = 'subjects_name_key';
      vi.spyOn(ALL_TABS[4], 'upsert').mockRejectedValue(pgError);

      validationService.validate.mockResolvedValue(
        makeValidatedWorkbook({
          [SCHOOL]: [{}],
          [ACADEMIC_YEARS]: [{}],
          [CLASSES]: [{}],
          [SECTIONS]: [{}],
          [SUBJECTS]: [{}],
        }),
      );

      await run();

      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      expect(jobRow.failed_tab).toBe(SUBJECTS);
      expect(jobRow.error).toBe('already exists: subjects_name_key');
      // 5 per-tab transactions attempted (4 succeeded, 5th threw — no 6th
      // tab touched) + the terminal FAILED-status/audit transaction.
      expect(dataSource.transaction).toHaveBeenCalledTimes(6);
      expect(ALL_TABS[0].upsert).toHaveBeenCalledTimes(1);
      expect(ALL_TABS[3].upsert).toHaveBeenCalledTimes(1);
      expect(restoreService.release).toHaveBeenCalledWith(TENANT, jobRow.id);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: expect.objectContaining({ event: 'RESTORE_FAILED', failed_tab: SUBJECTS }),
        }),

        expect.anything(),
      );
      expect(events.emitFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: WorkbookJobStatus.FAILED }),
      );
    });

    it('maps a 23503 foreign-key violation to a readable message', async () => {
      vi.spyOn(ALL_TABS[0], 'load').mockResolvedValue([]);
      vi.spyOn(ALL_TABS[0], 'keyOf').mockReturnValue('key');
      vi.spyOn(ALL_TABS[0], 'deleteByAbsence', 'get').mockReturnValue(false);
      const pgError = new QueryFailedError('insert', [], new Error('fk violation') as any);
      (pgError as any).code = '23503';
      vi.spyOn(ALL_TABS[0], 'upsert').mockRejectedValue(pgError);

      validationService.validate.mockResolvedValue(makeValidatedWorkbook({ [SCHOOL]: [{}] }));

      await run();

      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      // Direction-neutral: 23503 fires for both a missing parent and a
      // still-referenced row, so the message no longer assumes the latter.
      expect(jobRow.error).toBe(
        'related record missing or still referenced: foreign key constraint',
      );
      expect(jobRow.failed_tab).toBe(SCHOOL);
    });

    it('does not double-wrap an error a tab already pre-mapped itself (e.g. fees tabs on 23503)', async () => {
      vi.spyOn(ALL_TABS[0], 'load').mockResolvedValue([]);
      vi.spyOn(ALL_TABS[0], 'keyOf').mockReturnValue('key');
      vi.spyOn(ALL_TABS[0], 'deleteByAbsence', 'get').mockReturnValue(false);
      vi.spyOn(ALL_TABS[0], 'upsert').mockRejectedValue(
        new Error('Cannot delete student fee abc: it is referenced by a payment.'),
      );

      validationService.validate.mockResolvedValue(makeValidatedWorkbook({ [SCHOOL]: [{}] }));

      await run();

      expect(jobRow.error).toBe('Cannot delete student fee abc: it is referenced by a payment.');
    });
  });

  describe('invite-on-create (D5-ish)', () => {
    it('invites only users CREATED by the users tab, not updated ones', async () => {
      const usersTabIndex = ALL_TABS.findIndex((t) => t.name === 'users');
      const tab = ALL_TABS[usersTabIndex];

      vi.spyOn(tab, 'load').mockResolvedValue([{ id: 'existing-user' }] as any);
      vi.spyOn(tab, 'keyOf').mockImplementation((x: any) =>
        x?.id === 'existing-user' || x?.email === 'existing@x.com' ? 'existing-key' : 'new-key',
      );
      vi.spyOn(tab, 'deleteByAbsence', 'get').mockReturnValue(false);
      vi.spyOn(tab, 'upsert').mockImplementation(async (row: any) => ({ id: row.id }) as any);

      validationService.validate.mockResolvedValue(
        makeValidatedWorkbook({
          users: [
            { id: 'existing-user', email: 'existing@x.com' },
            { id: 'brand-new-user', email: 'new@x.com' },
          ],
        }),
      );

      processor = new RestoreProcessor(
        jobs,
        dataSource,
        storage,
        staging,
        validationService,
        invitations,
        audit,
        events,
        restoreService,
      );
      await processor.process({ data: { jobId: jobRow.id, inviteUsers: true } } as any);

      expect(jobRow.status).toBe(WorkbookJobStatus.DONE);
      expect(invitations.issueAndSend).toHaveBeenCalledTimes(1);
      expect(invitations.issueAndSend).toHaveBeenCalledWith({
        userId: 'brand-new-user',
        tenantId: TENANT,
        actorUserId: USER,
      });
    });

    it('never touches the tenant id embedded in the workbook itself — tenantId only comes from the job row', async () => {
      validationService.validate.mockResolvedValue(makeValidatedWorkbook({}));
      await run();
      expect(validationService.validate).toHaveBeenCalledWith(
        expect.anything(),
        TENANT,
        expect.anything(),
      );
    });

    // Regression: the RUNNING status write and the snapshot poll loop (up to
    // ten minutes of DB reads) used to sit outside the try/catch. A DB blip
    // there escaped `process()`, so the per-tenant restore lock was never
    // released — locking the school out of restore until the lock's TTL —
    // and the job row stayed RUNNING forever with no FAILED status.
    it('still releases the lock and fails the job when the RUNNING status write throws', async () => {
      validationService.validate.mockResolvedValue(makeValidatedWorkbook({}));
      jobs.update.mockRejectedValueOnce(new Error('connection terminated'));

      await expect(
        processor.process({ data: { jobId: jobRow.id, inviteUsers: false } } as any),
      ).resolves.toBeUndefined();

      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      expect(jobRow.error).toBe('connection terminated');
      expect(restoreService.release).toHaveBeenCalledWith(TENANT, jobRow.id);
      // Nothing was applied — the failure happened before any tab ran. The
      // one `transaction` call is `terminate`'s atomic FAILED-status +
      // audit-row write, not a per-tab restore transaction.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('still releases the lock and fails the job when a snapshot poll read throws', async () => {
      validationService.validate.mockResolvedValue(makeValidatedWorkbook({}));
      jobs.findOne
        .mockImplementationOnce(async () => jobRow)
        .mockRejectedValueOnce(new Error('snapshot read failed'));

      await expect(
        processor.process({ data: { jobId: jobRow.id, inviteUsers: false } } as any),
      ).resolves.toBeUndefined();

      expect(jobRow.status).toBe(WorkbookJobStatus.FAILED);
      expect(jobRow.error).toBe('snapshot read failed');
      expect(restoreService.release).toHaveBeenCalledWith(TENANT, jobRow.id);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });
});
