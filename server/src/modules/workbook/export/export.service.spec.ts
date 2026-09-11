import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportService } from './export.service';
import { WorkbookJobKind, WorkbookJobSource, WorkbookJobStatus } from '../jobs/workbook-job.entity';

describe('ExportService', () => {
  let jobs: any;
  let queue: any;
  let audit: any;
  let service: ExportService;

  const TENANT = 'tenant-1';
  const USER = 'user-1';

  beforeEach(() => {
    jobs = {
      create: vi.fn((input: any) => ({ id: 'job-1', ...input })),
      save: vi.fn(async (job: any) => job),
      update: vi.fn().mockResolvedValue(undefined),
    };
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new ExportService(jobs, queue, audit);
  });

  it('inserts a QUEUED row with the given kind/source/requested_by/tenant', async () => {
    const job = await service.run(TENANT, {
      kind: WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.MANUAL,
      requestedByUserId: USER,
    });

    expect(job.status).toBe(WorkbookJobStatus.QUEUED);
    expect(job.tenant_id).toBe(TENANT);
    expect(job.kind).toBe(WorkbookJobKind.EXPORT);
    expect(job.source).toBe(WorkbookJobSource.MANUAL);
    expect(job.requested_by_user_id).toBe(USER);
  });

  it('enqueues once on the workbook-export queue with the right payload and options', async () => {
    await service.run(TENANT, {
      kind: WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.MANUAL,
      requestedByUserId: USER,
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('export');
    expect(data).toEqual({ jobId: 'job-1', tenantId: TENANT });
    expect(opts).toMatchObject({ attempts: 2, removeOnComplete: true });
  });

  it('audits EXPORT_REQUESTED with the new row id and the caller tenant', async () => {
    const job = await service.run(TENANT, {
      kind: WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.MANUAL,
      requestedByUserId: USER,
    });

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0];
    expect(entry.entity_id).toBe(job.id);
    expect(entry.tenant_id).toBe(TENANT);
    expect(entry.new_values.event).toBe('EXPORT_REQUESTED');
  });

  it('marks the row FAILED and rethrows when the queue rejects, never leaving it QUEUED', async () => {
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(
      service.run(TENANT, {
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        requestedByUserId: USER,
      }),
    ).rejects.toThrow('redis down');

    expect(jobs.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: WorkbookJobStatus.FAILED,
        error: expect.any(String),
        finished_at: expect.any(Date),
      }),
    );
    // No audit write on the failure path — the request never succeeded.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not fail run when the audit write fails (fail-open)', async () => {
    audit.record.mockRejectedValue(new Error('audit db down'));

    // Even if AuditService's own fail-open guarantee were ever broken, a
    // transient audit-DB error must never turn an already-accepted,
    // already-enqueued export request into a failed one.
    const job = await service.run(TENANT, {
      kind: WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.MANUAL,
      requestedByUserId: USER,
    });

    expect(job.status).toBe(WorkbookJobStatus.QUEUED);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('rejects WorkbookJobKind.RESTORE and enqueues nothing', async () => {
    await expect(
      service.run(TENANT, {
        // Cast needed: the type signature already excludes RESTORE, but a
        // JS caller (or a controller bug) can still pass it through.
        kind: WorkbookJobKind.RESTORE as unknown as WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        requestedByUserId: USER,
      }),
    ).rejects.toThrow();

    expect(queue.add).not.toHaveBeenCalled();
    expect(jobs.save).not.toHaveBeenCalled();
  });
});
