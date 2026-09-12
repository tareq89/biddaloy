import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditAction } from '@biddaloy/shared';
import {
  KEEP_MANUAL_COUNT,
  KEEP_SCHEDULED_COUNT,
  RetentionService,
  SNAPSHOT_RETENTION_DAYS,
  STORAGE_CAP_BYTES,
} from './retention.service';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';

const TENANT_ID = 'tenant-1';
const DAY_MS = 24 * 60 * 60 * 1000;

function makeJob(id: string, overrides: Partial<WorkbookJob> = {}): WorkbookJob {
  return {
    id,
    tenant_id: TENANT_ID,
    kind: WorkbookJobKind.EXPORT,
    status: WorkbookJobStatus.DONE,
    source: WorkbookJobSource.SCHEDULED,
    requested_by_user_id: null,
    storage_key: `tenants/${TENANT_ID}/backups/${id}.xlsx`,
    size_bytes: '1000',
    pinned: false,
    expires_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    finished_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as WorkbookJob;
}

describe('RetentionService', () => {
  let service: RetentionService;
  let jobs: WorkbookJob[];
  let repo: { find: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let storage: { delete: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jobs = [];
    repo = {
      // The service issues three separate `find` calls (expired /
      // category-overflow / cap) each of which must reflect any updates
      // made by an earlier pass — mirror that against the in-memory array.
      find: vi.fn(async (opts: any) => {
        let rows = jobs.filter((j) => j.tenant_id === opts.where.tenant_id);
        if (opts.where.status !== undefined)
          rows = rows.filter((j) => j.status === opts.where.status);
        if (opts.where.pinned !== undefined)
          rows = rows.filter((j) => j.pinned === opts.where.pinned);
        if (opts.order?.created_at === 'DESC') {
          rows = [...rows].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        } else if (opts.order?.created_at === 'ASC') {
          rows = [...rows].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
        }
        return rows;
      }),
      update: vi.fn(async (id: string, patch: Partial<WorkbookJob>) => {
        const row = jobs.find((j) => j.id === id);
        if (row) Object.assign(row, patch);
      }),
    };
    storage = { delete: vi.fn().mockResolvedValue(undefined) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new RetentionService(
      repo as any,
      storage as unknown as StorageService,
      audit as unknown as AuditService,
    );
  });

  it('never touches a pinned job, even one that is expired, over-count, and over the cap', async () => {
    jobs.push(
      makeJob('pinned-1', {
        pinned: true,
        expires_at: new Date('2020-01-01T00:00:00.000Z'),
        size_bytes: String(STORAGE_CAP_BYTES * 2),
      }),
    );

    await service.enforce(TENANT_ID, new Date('2026-01-15T00:00:00.000Z'));

    expect(jobs[0].status).toBe(WorkbookJobStatus.DONE);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('deletes an unpinned job whose expires_at is in the past and audits BACKUP_DELETED', async () => {
    jobs.push(makeJob('expired-1', { expires_at: new Date('2020-01-01T00:00:00.000Z') }));

    await service.enforce(TENANT_ID, new Date('2026-01-15T00:00:00.000Z'));

    expect(jobs[0].status).toBe(WorkbookJobStatus.DELETED);
    expect(jobs[0].storage_key).toBeNull();
    // size_bytes is kept for history — never cleared by retention.
    expect(jobs[0].size_bytes).toBe('1000');
    expect(storage.delete).toHaveBeenCalledWith(`tenants/${TENANT_ID}/backups/expired-1.xlsx`);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.BACKUP_DELETED, entity_id: 'expired-1' }),
    );
  });

  it('keeps exactly the newest 8 SCHEDULED DONE exports across 12 simulated weekly runs', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    for (let week = 0; week < 12; week += 1) {
      jobs.push(
        makeJob(`sched-${week}`, {
          source: WorkbookJobSource.SCHEDULED,
          created_at: new Date(now.getTime() - week * 7 * DAY_MS),
        }),
      );
    }

    await service.enforce(TENANT_ID, now);

    const survivors = jobs.filter((j) => j.status === WorkbookJobStatus.DONE);
    expect(survivors).toHaveLength(KEEP_SCHEDULED_COUNT);
    // The newest 8 (week 0..7) survive; week 8..11 are pruned.
    for (let week = 0; week < KEEP_SCHEDULED_COUNT; week += 1) {
      expect(jobs.find((j) => j.id === `sched-${week}`)?.status).toBe(WorkbookJobStatus.DONE);
    }
    for (let week = KEEP_SCHEDULED_COUNT; week < 12; week += 1) {
      expect(jobs.find((j) => j.id === `sched-${week}`)?.status).toBe(WorkbookJobStatus.DELETED);
    }
  });

  it('keeps only the newest 3 MANUAL exports', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    for (let i = 0; i < 6; i += 1) {
      jobs.push(
        makeJob(`manual-${i}`, {
          source: WorkbookJobSource.MANUAL,
          created_at: new Date(now.getTime() - i * DAY_MS),
        }),
      );
    }

    await service.enforce(TENANT_ID, now);

    for (let i = 0; i < KEEP_MANUAL_COUNT; i += 1) {
      expect(jobs.find((j) => j.id === `manual-${i}`)?.status).toBe(WorkbookJobStatus.DONE);
    }
    for (let i = KEEP_MANUAL_COUNT; i < 6; i += 1) {
      expect(jobs.find((j) => j.id === `manual-${i}`)?.status).toBe(WorkbookJobStatus.DELETED);
    }
  });

  it('does not count a RESTORE job against the MANUAL export quota (#616 review finding)', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    // 3 recent RESTORE rows must not evict, or themselves get evicted as,
    // the 3 kept MANUAL exports — they are history, not backup artefacts.
    for (let i = 0; i < 3; i += 1) {
      jobs.push(
        makeJob(`restore-${i}`, {
          kind: WorkbookJobKind.RESTORE,
          source: WorkbookJobSource.MANUAL,
          created_at: new Date(now.getTime() - i * DAY_MS),
        }),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      jobs.push(
        makeJob(`export-${i}`, {
          kind: WorkbookJobKind.EXPORT,
          source: WorkbookJobSource.MANUAL,
          created_at: new Date(now.getTime() - (i + 10) * DAY_MS),
        }),
      );
    }

    await service.enforce(TENANT_ID, now);

    for (let i = 0; i < 3; i += 1) {
      expect(jobs.find((j) => j.id === `restore-${i}`)?.status).toBe(WorkbookJobStatus.DONE);
    }
    for (let i = 0; i < KEEP_MANUAL_COUNT; i += 1) {
      expect(jobs.find((j) => j.id === `export-${i}`)?.status).toBe(WorkbookJobStatus.DONE);
    }
    expect(jobs.find((j) => j.id === 'export-3')?.status).toBe(WorkbookJobStatus.DELETED);
  });

  it('removes a SNAPSHOT older than 30 days but keeps a younger one', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    jobs.push(
      makeJob('snap-old', {
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        created_at: new Date(now.getTime() - (SNAPSHOT_RETENTION_DAYS + 1) * DAY_MS),
      }),
    );
    jobs.push(
      makeJob('snap-young', {
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        created_at: new Date(now.getTime() - (SNAPSHOT_RETENTION_DAYS - 1) * DAY_MS),
      }),
    );

    await service.enforce(TENANT_ID, now);

    expect(jobs.find((j) => j.id === 'snap-old')?.status).toBe(WorkbookJobStatus.DELETED);
    expect(jobs.find((j) => j.id === 'snap-young')?.status).toBe(WorkbookJobStatus.DONE);
  });

  it('deletes the oldest unpinned job first while the tenant is over the 500 MB cap', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    // 3 jobs at 200 MB each = 600 MB, over the 500 MB cap by 100 MB.
    const chunk = 200 * 1024 * 1024;
    jobs.push(
      makeJob('cap-oldest', {
        source: WorkbookJobSource.MANUAL,
        size_bytes: String(chunk),
        created_at: new Date(now.getTime() - 3 * DAY_MS),
      }),
      makeJob('cap-middle', {
        source: WorkbookJobSource.MANUAL,
        size_bytes: String(chunk),
        created_at: new Date(now.getTime() - 2 * DAY_MS),
      }),
      makeJob('cap-newest', {
        source: WorkbookJobSource.MANUAL,
        size_bytes: String(chunk),
        created_at: new Date(now.getTime() - 1 * DAY_MS),
      }),
    );

    await service.enforce(TENANT_ID, now);

    expect(jobs.find((j) => j.id === 'cap-oldest')?.status).toBe(WorkbookJobStatus.DELETED);
    expect(jobs.find((j) => j.id === 'cap-middle')?.status).toBe(WorkbookJobStatus.DONE);
    expect(jobs.find((j) => j.id === 'cap-newest')?.status).toBe(WorkbookJobStatus.DONE);
  });

  it('never evicts a pinned job to relieve the cap, even though it counts toward the total', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const chunk = 300 * 1024 * 1024;
    jobs.push(
      makeJob('pinned-big', {
        pinned: true,
        source: WorkbookJobSource.MANUAL,
        size_bytes: String(chunk),
        created_at: new Date(now.getTime() - 2 * DAY_MS),
      }),
      makeJob('unpinned-big', {
        source: WorkbookJobSource.MANUAL,
        size_bytes: String(chunk),
        created_at: new Date(now.getTime() - 1 * DAY_MS),
      }),
    );

    await service.enforce(TENANT_ID, now);

    // Total (600 MB) is over the cap, but only the unpinned row can be
    // evicted — the pinned one stays even though the tenant is still over
    // the cap afterward.
    expect(jobs.find((j) => j.id === 'pinned-big')?.status).toBe(WorkbookJobStatus.DONE);
    expect(jobs.find((j) => j.id === 'unpinned-big')?.status).toBe(WorkbookJobStatus.DELETED);
  });

  it('does not fail the sweep when StorageService.delete throws, and leaves the row untouched', async () => {
    jobs.push(makeJob('boom', { expires_at: new Date('2020-01-01T00:00:00.000Z') }));
    storage.delete.mockRejectedValueOnce(new Error('object store unreachable'));

    await expect(
      service.enforce(TENANT_ID, new Date('2026-01-15T00:00:00.000Z')),
    ).resolves.not.toThrow();

    expect(jobs[0].status).toBe(WorkbookJobStatus.DONE);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not falsely count bytes as freed when the cap sweep hits a storage failure (#616 review finding)', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const chunk = 300 * 1024 * 1024;
    // Both rows are over cap (600 MB); the oldest fails to delete from
    // storage, so the tenant must still be considered over cap and the
    // second (newer) row must also be evicted rather than the sweep
    // stopping early on a total that only looked like it dropped below cap.
    jobs.push(
      makeJob('cap-a', {
        source: WorkbookJobSource.MANUAL,
        size_bytes: String(chunk),
        created_at: new Date(now.getTime() - 2 * DAY_MS),
      }),
      makeJob('cap-b', {
        source: WorkbookJobSource.MANUAL,
        size_bytes: String(chunk),
        created_at: new Date(now.getTime() - 1 * DAY_MS),
      }),
    );
    storage.delete.mockRejectedValueOnce(new Error('object store unreachable'));

    await service.enforce(TENANT_ID, now);

    // cap-a's storage delete failed — it stays DONE, and its bytes were
    // never subtracted from the running total, so the sweep correctly
    // keeps going and evicts cap-b too instead of stopping early.
    expect(jobs.find((j) => j.id === 'cap-a')?.status).toBe(WorkbookJobStatus.DONE);
    expect(jobs.find((j) => j.id === 'cap-b')?.status).toBe(WorkbookJobStatus.DELETED);
  });
});
