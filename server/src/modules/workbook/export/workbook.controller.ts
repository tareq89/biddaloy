import {
  Body,
  ConflictException,
  Controller,
  Get,
  GoneException,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Not, Repository } from 'typeorm';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { StorageService } from '../../storage/storage.service';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';
import { ExportService } from './export.service';
import { XLSX_MIME } from './export.constants';
import {
  PinWorkbookJobDto,
  QueryWorkbookJobsDto,
  RequestExportDto,
  RequestExportResponseDto,
  WorkbookJobDto,
  WorkbookJobListResponseDto,
  buildDownloadFilename,
  toWorkbookJobDto,
} from './dto/workbook-job.dto';

/**
 * [14.7.2] HTTP surface for workbook exports — request one, list/read job
 * history, and download a finished workbook as an authenticated stream.
 * No public or signed URLs; the download route is session-authenticated
 * like `SchoolLogoController.serve`.
 */
@ApiTags('backup')
@ApiTenantAuth()
@Controller('backup')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions(Permission.BACKUP_MANAGE)
export class WorkbookController {
  constructor(
    private readonly exports: ExportService,
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    private readonly storage: StorageService,
  ) {}

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @ApiOperation({
    summary:
      "Queue a workbook export for the caller's school. Returns immediately with the job id; poll GET /backup/jobs/:id for progress.",
  })
  @ApiResponse({ status: 202, type: RequestExportResponseDto })
  async requestExport(
    @Body() dto: RequestExportDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<RequestExportResponseDto> {
    const job = await this.exports.run(tenant.id, {
      kind: dto.kind ?? WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.MANUAL,
      requestedByUserId: user.sub,
    });
    return { job_id: job.id };
  }

  @Get('jobs')
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @ApiOkResponse({ type: WorkbookJobListResponseDto })
  async list(
    @Query() query: QueryWorkbookJobsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<WorkbookJobListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.jobs.findAndCount({
      where: {
        tenant_id: tenant.id,
        ...(query.kind && { kind: query.kind }),
        ...(query.status && { status: query.status }),
      },
      relations: ['requested_by'],
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Unfiltered by kind/status/page — the storage cap (14.12.2) is over
    // every DONE, still-stored object for the tenant, not just this page.
    const totalRow = await this.jobs
      .createQueryBuilder('job')
      .select('COALESCE(SUM(job.size_bytes), 0)', 'total_bytes')
      .where('job.tenant_id = :tenantId', { tenantId: tenant.id })
      .andWhere('job.status = :status', { status: WorkbookJobStatus.DONE })
      .getRawOne<{ total_bytes: string }>();

    return {
      data: rows.map(toWorkbookJobDto),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      storage_total_bytes: totalRow?.total_bytes ?? '0',
    };
  }

  @Patch('jobs/:id/pin')
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @ApiOperation({ summary: 'Pin or unpin a backup job — a pinned job is exempt from retention.' })
  @ApiOkResponse({ type: WorkbookJobDto })
  async pin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PinWorkbookJobDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<WorkbookJobDto> {
    // Conditional, not read-then-write: `RetentionService.deleteRow` claims
    // a row by flipping it to DELETED under `status = DONE AND pinned =
    // false`, and this is the other half of that protocol. Matching zero
    // rows here means either the job was never this tenant's, or retention
    // got there first — in which case a 200 would tell the user a backup is
    // safe that is already gone (or mid-deletion). Any non-DELETED status
    // may still be pinned, same as before.
    const result = await this.jobs.update(
      { id, tenant_id: tenant.id, status: Not(WorkbookJobStatus.DELETED) },
      { pinned: dto.pinned },
    );
    if (!result.affected) {
      const exists = await this.jobs.exists({ where: { id, tenant_id: tenant.id } });
      if (!exists) {
        throw new NotFoundException('Backup job not found');
      }
      throw new GoneException('This backup has been removed.');
    }
    const job = await this.jobs.findOne({
      where: { id, tenant_id: tenant.id },
      relations: ['requested_by'],
    });
    if (!job) {
      throw new NotFoundException('Backup job not found');
    }
    return toWorkbookJobDto(job);
  }

  // Declared before `jobs/:id` so route matching stays unambiguous.
  @Get('jobs/:id/download')
  @RequirePermissions(Permission.BACKUP_MANAGE)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Stream the finished workbook. Session-authenticated — there is no signed or public URL.',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const job = await this.jobs.findOne({
      where: { id, tenant_id: tenant.id },
      relations: ['tenant'],
    });
    if (!job) {
      throw new NotFoundException('Backup job not found');
    }
    if (job.status === WorkbookJobStatus.DELETED) {
      throw new GoneException('This backup has been removed.');
    }
    if (job.expires_at !== null && job.expires_at.getTime() <= Date.now()) {
      throw new GoneException('This backup has expired.');
    }
    if (job.status !== WorkbookJobStatus.DONE) {
      throw new ConflictException('This backup is not ready to download.');
    }
    if (!job.storage_key) {
      throw new GoneException('This backup has been removed.');
    }

    const { body } = await this.storage.get(job.storage_key);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${buildDownloadFilename(job)}"`);
    if (job.size_bytes) {
      res.setHeader('Content-Length', job.size_bytes);
    }
    return new StreamableFile(body);
  }

  @Get('jobs/:id')
  @RequirePermissions(Permission.BACKUP_MANAGE)
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<WorkbookJobDto> {
    const job = await this.jobs.findOne({
      where: { id, tenant_id: tenant.id },
      relations: ['requested_by'],
    });
    if (!job) {
      throw new NotFoundException('Backup job not found');
    }
    return toWorkbookJobDto(job);
  }
}
