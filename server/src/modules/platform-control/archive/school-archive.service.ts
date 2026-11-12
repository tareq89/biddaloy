import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApprovalScope, AuditAction, ImpersonationEndedBy } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import type { RequestContext } from '../../auth/refresh-token.service';
import { School } from '../../schools/entities/school.entity';
import { SchoolsService } from '../../schools/schools.service';
import { ImpersonationSessionService } from '../../support-access/sessions/impersonation-session.service';
import { StorageService } from '../../storage/storage.service';
import { ExportService } from '../../workbook/export/export.service';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../../workbook/jobs/workbook-job.entity';
import { buildDownloadFilename } from '../../workbook/export/dto/workbook-job.dto';
import type {
  ArchiveExportStatusDto,
  ArchiveSchoolDto,
  ArchiveSchoolResponseDto,
} from './dto/school-archive.dto';

const notReady = () =>
  new ConflictException({
    message: 'Finish an export of this school before archiving it',
    details: { code: 'EXPORT_NOT_READY' },
  });

/**
 * [Epic 99, D7] Archive = export the workbook, download it, then suspend. Nothing is deleted, and
 * reactivating uses the existing status route. The export is pinned so retention keeps it.
 */
@Injectable()
export class SchoolArchiveService {
  constructor(
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly exports: ExportService,
    private readonly storage: StorageService,
    private readonly schoolsService: SchoolsService,
    private readonly sessions: ImpersonationSessionService,
    private readonly audit: AuditService,
  ) {}

  async startExport(schoolId: string): Promise<{ jobId: string }> {
    await this.assertSchool(schoolId);
    // ponytail: check-then-insert, so two clicks in the same millisecond can start two exports; a per-school advisory lock if that ever matters.
    const running = await this.jobs.exist({
      where: {
        tenant_id: schoolId,
        kind: WorkbookJobKind.EXPORT,
        status: In([WorkbookJobStatus.QUEUED, WorkbookJobStatus.RUNNING]),
      },
    });
    if (running) {
      throw new ConflictException({
        message: 'An export is already running for this school',
        details: { code: 'EXPORT_ALREADY_RUNNING' },
      });
    }
    // Platform actors are not school users: no requested_by.
    const job = await this.exports.run(schoolId, {
      kind: WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.MANUAL,
      requestedByUserId: null,
    });
    return { jobId: job.id };
  }

  private async assertSchool(schoolId: string): Promise<void> {
    if (!(await this.schools.exist({ where: { id: schoolId } }))) {
      throw new NotFoundException('School not found');
    }
  }

  /** Scoped by the school in the path: another school's job is the same 404 as a missing one. */
  private async jobOf(schoolId: string, jobId: string, withTenant = false): Promise<WorkbookJob> {
    const job = await this.jobs.findOne({
      where: { id: jobId, tenant_id: schoolId, kind: WorkbookJobKind.EXPORT },
      relations: withTenant ? ['tenant'] : [],
    });
    if (!job) throw new NotFoundException('Export not found');
    return job;
  }

  async getExport(schoolId: string, jobId: string): Promise<ArchiveExportStatusDto> {
    const j = await this.jobOf(schoolId, jobId);
    return {
      id: j.id,
      status: j.status,
      sizeBytes: j.size_bytes,
      pinned: j.pinned,
      error: j.error,
      expiresAt: j.expires_at?.toISOString() ?? null,
      finishedAt: j.finished_at?.toISOString() ?? null,
    };
  }

  private isExpired(j: WorkbookJob): boolean {
    // Pinned = keep forever, same as the school's own download.
    return !j.pinned && j.expires_at !== null && j.expires_at.getTime() <= Date.now();
  }

  async download(schoolId: string, jobId: string) {
    const job = await this.jobOf(schoolId, jobId, true);
    if (job.status === WorkbookJobStatus.DELETED) {
      throw new GoneException('This export has been removed.');
    }
    if (this.isExpired(job)) throw new GoneException('This export has expired.');
    if (job.status !== WorkbookJobStatus.DONE) {
      throw new ConflictException('This export is not ready to download.');
    }
    if (!job.storage_key) throw new GoneException('This export has been removed.');
    const { body } = await this.storage.get(job.storage_key);
    return { body, filename: buildDownloadFilename(job), sizeBytes: job.size_bytes };
  }

  async archive(
    schoolId: string,
    dto: ArchiveSchoolDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<ArchiveSchoolResponseDto> {
    await this.assertSchool(schoolId);
    const job = await this.jobOf(schoolId, dto.exportJobId);
    if (job.status !== WorkbookJobStatus.DONE || !job.storage_key || this.isExpired(job)) {
      throw notReady();
    }
    // Pin first, conditionally on DONE: retention claims unpinned DONE rows, so the file the owner
    // downloaded cannot vanish between this check and the suspension.
    const pinned = await this.jobs.update(
      { id: job.id, tenant_id: schoolId, status: WorkbookJobStatus.DONE },
      { pinned: true },
    );
    if (!pinned.affected) throw notReady();

    await this.schoolsService.updateStatus(
      schoolId,
      { status: 'SUSPENDED', reason: `Archived: ${dto.reason.trim()}` },
      actorUserId,
      context,
    );
    await this.sessions.revokeAllForSchool(schoolId, ImpersonationEndedBy.OWNER);
    await this.audit.recordApproved({
      action: AuditAction.PLATFORM_SCHOOL_ARCHIVED,
      entity_type: 'School',
      entity_id: schoolId,
      tenant_id: schoolId,
      performed_by_user_id: actorUserId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { exportJobId: job.id },
      approved_by_user_id: actorUserId,
      approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
    });
    return { id: schoolId, status: 'SUSPENDED', exportJobId: job.id };
  }
}
