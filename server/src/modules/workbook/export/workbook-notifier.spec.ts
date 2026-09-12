import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkbookNotifier } from './workbook-notifier';
import { WorkbookJobKind, WorkbookJobSource, WorkbookJobStatus } from '../jobs/workbook-job.entity';
import { WorkbookJobFinishedPayload } from './export.constants';

describe('WorkbookNotifier', () => {
  let jobs: any;
  let events: any;
  let delivery: any;
  let schools: any;
  let config: any;
  let notifier: WorkbookNotifier;

  const TENANT = 'tenant-1';
  const JOB_ID = 'job-1';
  const USER_ID = 'user-1';
  const FINISHED_AT = new Date('2026-01-15T10:30:00.000Z');
  const EXPIRES_AT = new Date('2026-01-22T10:30:00.000Z');

  const SNAPSHOT_JOB_ID = 'snapshot-job-1';

  const baseRow = {
    id: JOB_ID,
    tenant_id: TENANT,
    status: WorkbookJobStatus.DONE,
    finished_at: FINISHED_AT,
    expires_at: EXPIRES_AT,
    error: null,
    snapshot_job_id: SNAPSHOT_JOB_ID,
    requested_by: { email: 'requester@example.com', full_name: 'Requester Name' },
  };

  const basePayload = (
    overrides: Partial<WorkbookJobFinishedPayload> = {},
  ): WorkbookJobFinishedPayload => ({
    jobId: JOB_ID,
    tenantId: TENANT,
    kind: WorkbookJobKind.EXPORT,
    source: WorkbookJobSource.MANUAL,
    status: WorkbookJobStatus.DONE,
    requestedByUserId: USER_ID,
    storageKey: 'secret/storage/key.xlsx',
    sizeBytes: '1048576',
    rowCounts: null,
    error: null,
    ...overrides,
  });

  beforeEach(() => {
    jobs = { findOne: vi.fn().mockResolvedValue(baseRow) };
    events = { onFinished: vi.fn() };
    delivery = { deliver: vi.fn().mockResolvedValue({ logId: 'log-1', status: 'SENT' }) };
    schools = {
      getResolvedSettings: vi
        .fn()
        .mockResolvedValue({ region: { locale: 'en-US', timezone: 'UTC' } }),
    };
    config = { get: vi.fn().mockReturnValue('https://app.biddaloy.com') };
    notifier = new WorkbookNotifier(jobs, events, delivery, schools, config);
  });

  it('fires on DONE + MANUAL with kind BACKUP_READY and a settings deep link', async () => {
    await notifier.onJobFinished(basePayload());

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    const input = delivery.deliver.mock.calls[0][0];
    expect(input.kind).toBe('BACKUP_READY');
    expect(input.medium).toBe('EMAIL');
    expect(input.to).toBe('requester@example.com');
    expect(input.vars.link).toMatch(new RegExp(`/settings\\?backup=${JOB_ID}$`));
  });

  it('skips on DONE + SCHEDULED (D9) without reading the DB', async () => {
    await notifier.onJobFinished(basePayload({ source: WorkbookJobSource.SCHEDULED }));

    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(jobs.findOne).not.toHaveBeenCalled();
  });

  it('skips on DONE + SNAPSHOT (D9) — a pre-restore safety copy is not a user request', async () => {
    // The snapshot is taken automatically before a restore. Emailing "your
    // backup is ready, download it" for an internal artefact nobody asked
    // for would fire on every single restore.
    await notifier.onJobFinished(basePayload({ source: WorkbookJobSource.SNAPSHOT }));

    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(jobs.findOne).not.toHaveBeenCalled();
  });

  it('fires on FAILED + SNAPSHOT — failures are never silenced by source', async () => {
    jobs.findOne.mockResolvedValue({ ...baseRow, status: WorkbookJobStatus.FAILED });

    await notifier.onJobFinished(
      basePayload({ source: WorkbookJobSource.SNAPSHOT, status: WorkbookJobStatus.FAILED }),
    );

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it('fires on FAILED + SCHEDULED — failures are never silenced by source', async () => {
    jobs.findOne.mockResolvedValue({ ...baseRow, status: WorkbookJobStatus.FAILED });

    await notifier.onJobFinished(
      basePayload({ source: WorkbookJobSource.SCHEDULED, status: WorkbookJobStatus.FAILED }),
    );

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(delivery.deliver.mock.calls[0][0].kind).toBe('BACKUP_FAILED');
  });

  it('fires on FAILED + MANUAL with a sanitised reason', async () => {
    jobs.findOne.mockResolvedValue({ ...baseRow, status: WorkbookJobStatus.FAILED });

    await notifier.onJobFinished(
      basePayload({ status: WorkbookJobStatus.FAILED, error: 'Disk full\nstack trace line 2' }),
    );

    const input = delivery.deliver.mock.calls[0][0];
    expect(input.kind).toBe('BACKUP_FAILED');
    expect(input.vars.reason).toBe('Disk full');
  });

  it('does nothing when there is no requester, without throwing (debug, not warn/error)', async () => {
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
    (notifier as any).logger = logger;

    await notifier.onJobFinished(basePayload({ requestedByUserId: null }));

    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('skips when the requester has no email, without throwing', async () => {
    jobs.findOne.mockResolvedValue({
      ...baseRow,
      requested_by: { email: null, full_name: 'No Email' },
    });

    await notifier.onJobFinished(basePayload());

    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('skips when the job row is not found, without throwing', async () => {
    jobs.findOne.mockResolvedValue(null);

    await notifier.onJobFinished(basePayload());

    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('reads the row (with terminal status and finished_at) before delivering', async () => {
    let findOneResolved = false;
    jobs.findOne.mockImplementation(async () => {
      findOneResolved = true;
      expect(baseRow.status).toBe(WorkbookJobStatus.DONE);
      expect(baseRow.finished_at).not.toBeNull();
      return baseRow;
    });
    delivery.deliver.mockImplementation(async () => {
      expect(findOneResolved).toBe(true);
      return { logId: 'log-1', status: 'SENT' };
    });

    await notifier.onJobFinished(basePayload());

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it('does not rethrow and logs at error when deliver rejects', async () => {
    const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
    (notifier as any).logger = logger;
    delivery.deliver.mockRejectedValue(new Error('smtp down'));

    await expect(notifier.onJobFinished(basePayload())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('filters findOne by both id and tenant_id', async () => {
    await notifier.onJobFinished(basePayload());

    expect(jobs.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: JOB_ID, tenant_id: TENANT },
      }),
    );
  });

  it('never leaks the storage key to the delivery service', async () => {
    const payload = basePayload({ storageKey: 'super-secret-storage-key-xyz' });
    await notifier.onJobFinished(payload);

    const serialized = JSON.stringify(delivery.deliver.mock.calls);
    expect(serialized).not.toContain(payload.storageKey);
  });

  it('fires RESTORE_DONE for a DONE RESTORE job, with a link to the snapshot job', async () => {
    await notifier.onJobFinished(basePayload({ kind: WorkbookJobKind.RESTORE }));

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    const input = delivery.deliver.mock.calls[0][0];
    expect(input.kind).toBe('RESTORE_DONE');
    expect(input.vars.link).toMatch(new RegExp(`/settings\\?backup=${SNAPSHOT_JOB_ID}$`));
  });

  it('fires RESTORE_FAILED for a FAILED RESTORE job, with a sanitised reason', async () => {
    jobs.findOne.mockResolvedValue({ ...baseRow, status: WorkbookJobStatus.FAILED });

    await notifier.onJobFinished(
      basePayload({
        kind: WorkbookJobKind.RESTORE,
        status: WorkbookJobStatus.FAILED,
        error: 'Row 12: invalid class id\nstack trace line 2',
      }),
    );

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    const input = delivery.deliver.mock.calls[0][0];
    expect(input.kind).toBe('RESTORE_FAILED');
    expect(input.vars.reason).toBe('Row 12: invalid class id');
    // Failures still link to the snapshot — it's the rollback path.
    expect(input.vars.link).toMatch(new RegExp(`/settings\\?backup=${SNAPSHOT_JOB_ID}$`));
  });

  it('a DONE RESTORE job still emails even though it is not source MANUAL-gated like exports (D9 only applies to BACKUP_*)', async () => {
    // RestoreService always sets source MANUAL for a restore it requests,
    // but this asserts the RESTORE_DONE branch is reached via `kind`, not
    // by relying on the D9 source check to have already narrowed things.
    await notifier.onJobFinished(
      basePayload({ kind: WorkbookJobKind.RESTORE, source: WorkbookJobSource.MANUAL }),
    );

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(delivery.deliver.mock.calls[0][0].kind).toBe('RESTORE_DONE');
  });

  it('falls back to the restore job id for the link when snapshot_job_id is null', async () => {
    jobs.findOne.mockResolvedValue({ ...baseRow, snapshot_job_id: null });

    await notifier.onJobFinished(basePayload({ kind: WorkbookJobKind.RESTORE }));

    const input = delivery.deliver.mock.calls[0][0];
    expect(input.vars.link).toMatch(new RegExp(`/settings\\?backup=${JOB_ID}$`));
  });

  it('registers exactly one listener on module init, which routes to onJobFinished', () => {
    const spy = vi.spyOn(notifier, 'onJobFinished').mockResolvedValue(undefined);

    notifier.onModuleInit();

    expect(events.onFinished).toHaveBeenCalledTimes(1);
    const handler = events.onFinished.mock.calls[0][0];
    const payload = basePayload();
    handler(payload);

    expect(spy).toHaveBeenCalledWith(payload);
  });
});
