import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { ApprovalScope, AuditAction, ImpersonationEndedBy } from '@biddaloy/shared';
import { WorkbookJobStatus } from '../../workbook/jobs/workbook-job.entity';
import { SchoolArchiveService } from './school-archive.service';

const SCHOOL = 'school-a';
const ctx = { ip: '1.1.1.1', userAgent: 'vitest' };

const doneJob = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  tenant_id: SCHOOL,
  status: WorkbookJobStatus.DONE,
  storage_key: 'k',
  pinned: false,
  expires_at: null,
  size_bytes: '10',
  tenant: { slug: 'a' },
  created_at: new Date('2026-01-01T00:00:00Z'),
  finished_at: new Date('2026-01-01T00:01:00Z'),
  kind: 'EXPORT',
  ...over,
});

describe('SchoolArchiveService', () => {
  const jobs = { findOne: vi.fn(), exist: vi.fn(), update: vi.fn() };
  const schools = { exist: vi.fn() };
  const exportsSvc = { run: vi.fn() };
  const storage = { get: vi.fn() };
  const schoolsService = { updateStatus: vi.fn() };
  const sessions = { revokeAllForSchool: vi.fn() };
  const audit = { recordApproved: vi.fn() };
  let service: SchoolArchiveService;

  beforeEach(() => {
    vi.resetAllMocks();
    schools.exist.mockImplementation(async ({ where }) => !where.is_platform);
    jobs.update.mockResolvedValue({ affected: 1 });
    storage.get.mockResolvedValue({ body: 'stream' });
    service = new SchoolArchiveService(
      jobs as never,
      schools as never,
      exportsSvc as never,
      storage as never,
      schoolsService as never,
      sessions as never,
      audit as never,
    );
  });

  describe('startExport', () => {
    it('queues an export with no requesting user', async () => {
      jobs.exist.mockResolvedValue(false);
      exportsSvc.run.mockResolvedValue({ id: 'job-1' });
      await expect(service.startExport(SCHOOL)).resolves.toEqual({ jobId: 'job-1' });
      expect(exportsSvc.run).toHaveBeenCalledWith(
        SCHOOL,
        expect.objectContaining({ requestedByUserId: null }),
      );
    });

    it('is 409 while another export is queued or running', async () => {
      jobs.exist.mockResolvedValue(true);
      await expect(service.startExport(SCHOOL)).rejects.toBeInstanceOf(ConflictException);
      expect(exportsSvc.run).not.toHaveBeenCalled();
    });

    it('is 404 for an unknown school', async () => {
      schools.exist.mockResolvedValue(false);
      await expect(service.startExport(SCHOOL)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getExport / download', () => {
    it('a job that is not this school is 404 (the lookup carries the school id)', async () => {
      jobs.findOne.mockResolvedValue(null);
      await expect(service.getExport(SCHOOL, 'j')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.download(SCHOOL, 'j')).rejects.toBeInstanceOf(NotFoundException);
      expect(jobs.findOne.mock.calls[0][0].where).toMatchObject({ tenant_id: SCHOOL });
    });

    it('streams a DONE job and builds the filename', async () => {
      jobs.findOne.mockResolvedValue(doneJob());
      const res = await service.download(SCHOOL, 'job-1');
      expect(res.body).toBe('stream');
      expect(res.filename).toBe('a-export-20260101-0001.xlsx');
    });

    it('DELETED and expired are 410; a pinned expired job still downloads; not DONE is 409', async () => {
      jobs.findOne.mockResolvedValueOnce(doneJob({ status: WorkbookJobStatus.DELETED }));
      await expect(service.download(SCHOOL, 'j')).rejects.toBeInstanceOf(GoneException);
      const past = new Date(Date.now() - 1000);
      jobs.findOne.mockResolvedValueOnce(doneJob({ expires_at: past }));
      await expect(service.download(SCHOOL, 'j')).rejects.toBeInstanceOf(GoneException);
      jobs.findOne.mockResolvedValueOnce(doneJob({ expires_at: past, pinned: true }));
      await expect(service.download(SCHOOL, 'j')).resolves.toBeDefined();
      jobs.findOne.mockResolvedValueOnce(doneJob({ status: WorkbookJobStatus.RUNNING }));
      await expect(service.download(SCHOOL, 'j')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('archive', () => {
    const dto = { exportJobId: 'job-1', reason: ' Left us ' };

    it('pins, suspends with the prefixed reason, ends sessions and audits', async () => {
      jobs.findOne.mockResolvedValue(doneJob());
      await service.archive(SCHOOL, dto, 'owner-1', ctx);
      expect(jobs.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1', status: WorkbookJobStatus.DONE }),
        { pinned: true },
      );
      expect(schoolsService.updateStatus).toHaveBeenCalledWith(
        SCHOOL,
        { status: 'SUSPENDED', reason: 'Archived: Left us' },
        'owner-1',
        ctx,
      );
      expect(sessions.revokeAllForSchool).toHaveBeenCalledWith(SCHOOL, ImpersonationEndedBy.OWNER);
      expect(audit.recordApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PLATFORM_SCHOOL_ARCHIVED,
          new_values: { exportJobId: 'job-1' },
          approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
        }),
      );
    });

    it('a job that is not DONE or has expired is 409 and nothing is suspended', async () => {
      for (const over of [
        { status: WorkbookJobStatus.RUNNING },
        { status: WorkbookJobStatus.FAILED },
        { expires_at: new Date(Date.now() - 1000) },
        { storage_key: null },
      ]) {
        jobs.findOne.mockResolvedValueOnce(doneJob(over));
        await expect(service.archive(SCHOOL, dto, 'o', ctx)).rejects.toBeInstanceOf(
          ConflictException,
        );
      }
      expect(schoolsService.updateStatus).not.toHaveBeenCalled();
    });

    it('is 409 when retention claimed the row between the read and the pin', async () => {
      jobs.findOne.mockResolvedValue(doneJob());
      jobs.update.mockResolvedValue({ affected: 0 });
      await expect(service.archive(SCHOOL, dto, 'o', ctx)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(schoolsService.updateStatus).not.toHaveBeenCalled();
    });

    it('refuses the platform home school before pinning anything', async () => {
      schools.exist.mockResolvedValue(true);
      await expect(service.archive(SCHOOL, dto, 'o', ctx)).rejects.toBeInstanceOf(ConflictException);
      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('another school job is 404', async () => {
      jobs.findOne.mockResolvedValue(null);
      await expect(service.archive(SCHOOL, dto, 'o', ctx)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
