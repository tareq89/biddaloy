import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictException,
  GoneException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Readable } from 'stream';
import { WorkbookController } from './workbook.controller';
import { ExportService } from './export.service';
import { StorageService } from '../../storage/storage.service';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';
import { toWorkbookJobDto, buildDownloadFilename } from './dto/workbook-job.dto';
import { XLSX_MIME } from './export.constants';

function makeJob(overrides: Partial<WorkbookJob> = {}): WorkbookJob {
  return {
    id: 'job-1',
    tenant: { slug: 'dhaka-model-school' } as WorkbookJob['tenant'],
    tenant_id: 'tenant-1',
    kind: WorkbookJobKind.EXPORT,
    status: WorkbookJobStatus.QUEUED,
    source: WorkbookJobSource.MANUAL,
    requested_by: null,
    requested_by_user_id: null,
    storage_key: null,
    size_bytes: null,
    row_counts: null,
    progress: null,
    staging_id: null,
    snapshot_job_id: null,
    failed_tab: null,
    error: null,
    pinned: false,
    expires_at: null,
    created_at: new Date('2026-09-11T09:30:00.000Z'),
    finished_at: null,
    ...overrides,
  } as WorkbookJob;
}

describe('WorkbookController', () => {
  let controller: WorkbookController;
  let exportsService: { run: ReturnType<typeof vi.fn> };
  let jobsRepo: { findAndCount: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn> };
  let storage: { get: ReturnType<typeof vi.fn> };
  const tenant = { id: 'tenant-1', role: 'ADMIN' };
  const user = { sub: 'user-1' } as any;

  beforeEach(() => {
    exportsService = { run: vi.fn() };
    jobsRepo = { findAndCount: vi.fn(), findOne: vi.fn() };
    storage = { get: vi.fn() };
    controller = new WorkbookController(
      exportsService as unknown as ExportService,
      jobsRepo as any,
      storage as unknown as StorageService,
    );
  });

  describe('requestExport', () => {
    it('calls ExportService.run with the context tenant id and user sub', async () => {
      exportsService.run.mockResolvedValue(makeJob({ id: 'job-42' }));

      const result = await controller.requestExport(
        { kind: WorkbookJobKind.SNAPSHOT },
        tenant,
        user,
      );

      expect(exportsService.run).toHaveBeenCalledWith('tenant-1', {
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.MANUAL,
        requestedByUserId: 'user-1',
      });
      expect(result).toEqual({ job_id: 'job-42' });
    });

    it('defaults kind to EXPORT when the body is empty', async () => {
      exportsService.run.mockResolvedValue(makeJob({ id: 'job-1' }));

      await controller.requestExport({}, tenant, user);

      expect(exportsService.run).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ kind: WorkbookJobKind.EXPORT }),
      );
    });
  });

  describe('list', () => {
    it('always scopes by tenant_id, forwards filters, orders by created_at DESC and paginates', async () => {
      jobsRepo.findAndCount.mockResolvedValue([[makeJob()], 41]);

      const result = await controller.list(
        { kind: WorkbookJobKind.EXPORT, status: WorkbookJobStatus.DONE, page: 3, limit: 20 },
        tenant,
      );

      expect(jobsRepo.findAndCount).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          kind: WorkbookJobKind.EXPORT,
          status: WorkbookJobStatus.DONE,
        },
        relations: ['requested_by'],
        order: { created_at: 'DESC' },
        skip: 40,
        take: 20,
      });
      expect(result.total).toBe(41);
      expect(result.totalPages).toBe(3);
    });
  });

  describe('get', () => {
    it('throws NotFoundException when the repo returns null', async () => {
      jobsRepo.findOne.mockResolvedValue(null);

      await expect(controller.get('missing-id', tenant)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the mapped dto when found', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob({ id: 'job-9' }));

      const result = await controller.get('job-9', tenant);

      expect(result.id).toBe('job-9');
    });
  });

  describe('download', () => {
    const res = { setHeader: vi.fn() } as any;

    beforeEach(() => {
      res.setHeader.mockClear();
    });

    it('returns 404 when the job does not exist in this tenant', async () => {
      jobsRepo.findOne.mockResolvedValue(null);

      await expect(controller.download('id', tenant, res)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 410 when the job is DELETED', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob({ status: WorkbookJobStatus.DELETED }));

      await expect(controller.download('id', tenant, res)).rejects.toBeInstanceOf(GoneException);
    });

    it('returns 410 when expires_at is in the past', async () => {
      jobsRepo.findOne.mockResolvedValue(
        makeJob({
          status: WorkbookJobStatus.DONE,
          storage_key: 'k',
          expires_at: new Date(Date.now() - 1000),
        }),
      );

      await expect(controller.download('id', tenant, res)).rejects.toBeInstanceOf(GoneException);
    });

    it('proceeds when expires_at is null (never expires) — proves C3', async () => {
      const job = makeJob({ status: WorkbookJobStatus.DONE, storage_key: 'k', expires_at: null });
      jobsRepo.findOne.mockResolvedValue(job);
      storage.get.mockResolvedValue({
        body: Readable.from(Buffer.from('x')),
        contentType: XLSX_MIME,
      });

      const result = await controller.download('id', tenant, res);

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('returns 409 when the job is not DONE', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob({ status: WorkbookJobStatus.QUEUED }));

      await expect(controller.download('id', tenant, res)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('returns 410 when DONE but storage_key is null', async () => {
      jobsRepo.findOne.mockResolvedValue(
        makeJob({ status: WorkbookJobStatus.DONE, storage_key: null }),
      );

      await expect(controller.download('id', tenant, res)).rejects.toBeInstanceOf(GoneException);
    });

    it('streams the workbook with the right headers on the happy path', async () => {
      const job = makeJob({
        status: WorkbookJobStatus.DONE,
        storage_key: 'tenants/t1/backups/uuid.xlsx',
        size_bytes: '1024',
        finished_at: new Date('2026-09-11T09:30:00.000Z'),
      });
      jobsRepo.findOne.mockResolvedValue(job);
      const body = Readable.from(Buffer.from('bytes'));
      storage.get.mockResolvedValue({ body, contentType: XLSX_MIME });

      const result = await controller.download('id', tenant, res);

      expect(storage.get).toHaveBeenCalledWith('tenants/t1/backups/uuid.xlsx');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', XLSX_MIME);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `attachment; filename="${buildDownloadFilename(job)}"`,
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '1024');
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('does not set Content-Length when size_bytes is null', async () => {
      jobsRepo.findOne.mockResolvedValue(
        makeJob({ status: WorkbookJobStatus.DONE, storage_key: 'k', size_bytes: null }),
      );
      storage.get.mockResolvedValue({
        body: Readable.from(Buffer.from('x')),
        contentType: XLSX_MIME,
      });

      await controller.download('id', tenant, res);

      expect(res.setHeader).not.toHaveBeenCalledWith('Content-Length', expect.anything());
    });
  });
});

describe('toWorkbookJobDto', () => {
  it('omits storage_key, staging_id and tenant_id, keeps size_bytes as string, maps requested_by', () => {
    const job = makeJob({
      requested_by: { id: 'u1', full_name: 'Ada Admin' } as WorkbookJob['requested_by'],
      size_bytes: '2048',
      storage_key: 'secret/key',
      staging_id: 'staging-1',
    });

    const dto = toWorkbookJobDto(job) as unknown as Record<string, unknown>;

    expect(dto.storage_key).toBeUndefined();
    expect(dto.staging_id).toBeUndefined();
    expect(dto.tenant_id).toBeUndefined();
    expect(dto.size_bytes).toBe('2048');
    expect(dto.requested_by).toEqual({ id: 'u1', full_name: 'Ada Admin' });
  });

  it('maps requested_by to null when absent', () => {
    const dto = toWorkbookJobDto(makeJob({ requested_by: null }));
    expect(dto.requested_by).toBeNull();
  });
});

describe('buildDownloadFilename', () => {
  it('builds <slug>-<kind>-<YYYYMMDD-HHmm>.xlsx from the tenant slug and finished_at', () => {
    const job = makeJob({
      tenant: { slug: 'Dhaka Model School!' } as WorkbookJob['tenant'],
      kind: WorkbookJobKind.EXPORT,
      finished_at: new Date('2026-09-11T09:30:00.000Z'),
    });

    expect(buildDownloadFilename(job)).toBe('dhaka-model-school-export-20260911-0930.xlsx');
  });

  it('falls back to "backup" when there is no slug', () => {
    const job = makeJob({ tenant: {} as WorkbookJob['tenant'] });
    expect(buildDownloadFilename(job)).toMatch(/^backup-export-\d{8}-\d{4}\.xlsx$/);
  });

  it('uses created_at when finished_at is null', () => {
    const job = makeJob({
      finished_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(buildDownloadFilename(job)).toBe('dhaka-model-school-export-20260101-0000.xlsx');
  });
});
