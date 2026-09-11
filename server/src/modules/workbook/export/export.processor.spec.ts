import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { ExportProcessor } from './export.processor';
import {
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';
import type { WorkbookExportJobData } from './export.constants';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

// Two minimal fake tabs, standing in for `codec/registry.ts#ALL_TABS`.
// `vi.hoisted` is required because `vi.mock` factories are hoisted above
// all top-level statements, including plain `const` declarations.
const { fakeTabA, fakeTabB } = vi.hoisted(() => {
  const base = {
    entity: {},
    excluded: [],
    dependsOn: [],
    columns: [{ key: 'id', type: 'uuid', label: { en: 'Id', bn: 'Id' } }],
    naturalKey: ['id'],
    deleteByAbsence: false,
    toRow: (e: any) => ({ id: e.id }),
    fromRow: () => ({ errors: [] }),
    keyOf: (x: any) => x.id,
    diffFields: () => [],
    upsert: async (r: any) => r,
    remove: async () => undefined,
  };
  return {
    fakeTabA: { ...base, name: 'fake_tab_a', load: vi.fn() },
    fakeTabB: { ...base, name: 'fake_tab_b', load: vi.fn() },
  };
});

vi.mock('../codec/registry', () => ({
  ALL_TABS: [fakeTabA, fakeTabB],
  EXPECTED_TABS: ['fake_tab_a', 'fake_tab_b'],
  assertRegistryValid: vi.fn(),
}));

vi.mock('../codec/workbook-codec', () => ({
  writeWorkbook: vi.fn(async ({ rowsFor, tabs }: any) => {
    // Drain every tab's async generator, same as the real writer would.
    for (const tab of tabs) {
      for await (const _row of rowsFor(tab)) {
        // no-op — this fake just needs to exercise rowsFor
      }
    }
    return Buffer.from('fake-xlsx-bytes');
  }),
}));

const TENANT = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
const JOB_ID = 'job-1';

function fakeJob(overrides: Partial<WorkbookExportJobData> = {}): Job<WorkbookExportJobData> {
  return {
    data: { jobId: JOB_ID, tenantId: TENANT, ...overrides },
    opts: { attempts: 2 },
    attemptsMade: 0,
  } as Job<WorkbookExportJobData>;
}

describe('ExportProcessor', () => {
  let jobsRepo: any;
  let dataSource: any;
  let storage: any;
  let audit: any;
  let events: any;
  let processor: ExportProcessor;

  function jobRow(overrides: Record<string, unknown> = {}) {
    return {
      id: JOB_ID,
      tenant_id: TENANT,
      kind: WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.MANUAL,
      status: WorkbookJobStatus.QUEUED,
      requested_by_user_id: 'user-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fakeTabA.load.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    fakeTabB.load.mockResolvedValue([{ id: 'b1' }]);

    jobsRepo = {
      findOne: vi.fn().mockResolvedValue(jobRow()),
      update: vi.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      manager: {
        findOne: vi.fn().mockResolvedValue({ id: TENANT, name: 'Test School', slug: 'test' }),
      },
    };
    storage = { put: vi.fn().mockResolvedValue(undefined) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    events = { emitFinished: vi.fn() };

    processor = new ExportProcessor(jobsRepo, dataSource, storage, audit, events);
  });

  it('happy path: RUNNING -> DONE with every terminal field set', async () => {
    await processor.process(fakeJob());

    const calls = jobsRepo.update.mock.calls;
    expect(calls[0]).toEqual([JOB_ID, { status: WorkbookJobStatus.RUNNING, progress: null }]);

    const doneCall = calls.find((c: any[]) => c[1].status === WorkbookJobStatus.DONE);
    expect(doneCall).toBeTruthy();
    const [, patch] = doneCall;
    expect(patch.storage_key).toEqual(expect.any(String));
    expect(typeof patch.size_bytes).toBe('string');
    expect(patch.row_counts).toEqual({ fake_tab_a: 2, fake_tab_b: 1 });
    expect(patch.finished_at).toBeInstanceOf(Date);
    expect(patch.error).toBeNull();
    expect(patch.failed_tab).toBeNull();

    const expiresAt = patch.expires_at as Date;
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt.getTime() - (Date.now() + expectedMs))).toBeLessThan(5000);
  });

  it('calls StorageService.put exactly once with a tenant-scoped xlsx key', async () => {
    await processor.process(fakeJob());

    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key, buffer, contentType] = storage.put.mock.calls[0];
    expect(key).toMatch(
      new RegExp(`^tenants/${TENANT}/backups/[0-9a-f-]{36}\\.xlsx$`),
    );
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('a tab load rejecting fails the job: status FAILED, failed_tab set, sanitised error, storage never called', async () => {
    fakeTabB.load.mockRejectedValue(new Error('SELECT * FROM students WHERE tenant_id=...'));

    await expect(processor.process(fakeJob())).rejects.toThrow();

    const calls = jobsRepo.update.mock.calls;
    const failedCall = calls.find((c: any[]) => c[1].status === WorkbookJobStatus.FAILED);
    expect(failedCall).toBeTruthy();
    const [, patch] = failedCall;
    expect(patch.failed_tab).toBe('fake_tab_b');
    expect(patch.error).not.toContain('SELECT');
    expect(patch.error).not.toContain('Error:');
    expect(storage.put).not.toHaveBeenCalled();

    // Never left RUNNING: the last status write must be terminal.
    const lastStatusCall = [...calls].reverse().find((c: any[]) => 'status' in c[1]);
    expect(lastStatusCall[1].status).toBe(WorkbookJobStatus.FAILED);
  });

  it('StorageService.put rejecting fails the job and never reaches DONE', async () => {
    storage.put.mockRejectedValue(new Error('S3 unavailable'));

    await expect(processor.process(fakeJob())).rejects.toThrow();

    const calls = jobsRepo.update.mock.calls;
    expect(calls.some((c: any[]) => c[1].status === WorkbookJobStatus.DONE)).toBe(false);
    const failedCall = calls.find((c: any[]) => c[1].status === WorkbookJobStatus.FAILED);
    expect(failedCall).toBeTruthy();
  });

  it('emits WORKBOOK_JOB_FINISHED once on DONE with status DONE', async () => {
    await processor.process(fakeJob());

    expect(events.emitFinished).toHaveBeenCalledTimes(1);
    expect(events.emitFinished.mock.calls[0][0]).toMatchObject({
      jobId: JOB_ID,
      tenantId: TENANT,
      status: WorkbookJobStatus.DONE,
    });
  });

  it('emits WORKBOOK_JOB_FINISHED once on FAILED with status FAILED, and a throwing listener does not change the outcome', async () => {
    events.emitFinished.mockImplementation(() => {
      throw new Error('listener bug');
    });
    fakeTabA.load.mockRejectedValue(new Error('db down'));

    await expect(processor.process(fakeJob())).rejects.toThrow('db down');

    expect(events.emitFinished).toHaveBeenCalledTimes(1);
    expect(events.emitFinished.mock.calls[0][0]).toMatchObject({ status: WorkbookJobStatus.FAILED });
  });

  it('queries the repo with both id and tenant_id — a row for another tenant is not found', async () => {
    jobsRepo.findOne.mockResolvedValue(null);

    await processor.process(fakeJob({ tenantId: OTHER_TENANT }));

    expect(jobsRepo.findOne).toHaveBeenCalledWith({
      where: { id: JOB_ID, tenant_id: OTHER_TENANT },
    });
    // No status transitions attempted for a row that isn't this tenant's.
    expect(jobsRepo.update).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('is a no-op when the row is already DONE (idempotent replay)', async () => {
    jobsRepo.findOne.mockResolvedValue(jobRow({ status: WorkbookJobStatus.DONE }));

    await processor.process(fakeJob());

    expect(jobsRepo.update).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });
});
