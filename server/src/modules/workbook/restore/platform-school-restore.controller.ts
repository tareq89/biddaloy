import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { JwtPayload } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { School } from '../../schools/entities/school.entity';
import { BACKUP_MAX_UPLOAD_BYTES } from '../export/export.constants';
import { WorkbookJobDto, toWorkbookJobDto } from '../export/dto/workbook-job.dto';
import { ImportController } from '../import/import.controller';
import type { ValidateResponseDto } from '../import/dto/validate-response.dto';
import { WorkbookJob } from '../jobs/workbook-job.entity';
import { XLSX_MIME } from '../template/template.constants';
import { GetTemplateDto } from '../template/dto/template.dto';
import { TemplateService } from '../template/template.service';
import { RequestRestoreDto, RequestRestoreResponseDto } from './dto/restore.dto';
import { RestoreService } from './restore.service';

/**
 * [4101] The platform owner's way into a school's workbook import. A cockpit token has no
 * school, so `ContextGuard` refuses the `/backup/*` routes; here the school comes from the path.
 * Every handler reuses the school-side code (`RestoreService.request`, `ImportController.stage`,
 * `TemplateService.build`), so the confirmation-name, staging and lock rules are the same.
 * `RestoreService.request` audits `RESTORE_REQUESTED` with the owner as `performed_by_user_id`.
 * A school that does not exist is the same 404 for every handler (Rules 23/24).
 */
@ApiTags('platform')
@ApiTenantAuth()
@Controller('platform/schools/:id/restore')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class PlatformSchoolRestoreController {
  constructor(
    private readonly restore: RestoreService,
    private readonly importer: ImportController,
    private readonly templates: TemplateService,
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
  ) {}

  private async assertSchool(id: string): Promise<void> {
    if (!(await this.schools.exists({ where: { id } }))) {
      throw new NotFoundException('School not found');
    }
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      "Queue a restore from a staged, validated workbook into any school (platform owners only). The school's exact name is the confirmation phrase.",
  })
  @ApiResponse({ status: 202, type: RequestRestoreResponseDto })
  async requestRestore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestRestoreDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RequestRestoreResponseDto> {
    await this.assertSchool(id);
    const { job, snapshotJob } = await this.restore.request(id, user.sub, {
      staging_id: dto.staging_id,
      confirmation: dto.confirmation,
      invite_users: dto.invite_users,
      from_platform: true,
    });
    return { job_id: job.id, snapshot_job_id: snapshotJob.id };
  }

  @Post('validate')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BACKUP_MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Validate and stage a workbook for a school (platform owners only).' })
  async validate(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ): Promise<ValidateResponseDto> {
    await this.assertSchool(id);
    return this.importer.stage(file, id, user.sub);
  }

  @Get('template')
  @Throttle({ default: STRICT_RATE_LIMIT })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The blank workbook template for a school (platform owners only).' })
  @ApiOkResponse({
    description: 'The blank .xlsx workbook.',
    content: { [XLSX_MIME]: { schema: { type: 'string', format: 'binary' } } },
  })
  async template(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetTemplateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    await this.assertSchool(id);
    const { buffer, lang } = await this.templates.build(id, query.lang, query.variant);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="biddaloy-template${query.variant === 'starter' ? '-starter' : ''}-${lang}.xlsx"`,
    );
    res.setHeader('Content-Length', buffer.byteLength);
    return new StreamableFile(buffer);
  }

  @Get('jobs/:jobId')
  @ApiOperation({
    summary: "Poll one of a school's restore or snapshot jobs (platform owners only).",
  })
  @ApiOkResponse({ type: WorkbookJobDto })
  async job(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<WorkbookJobDto> {
    const job = await this.jobs.findOne({
      where: { id: jobId, tenant_id: id },
      relations: ['requested_by'],
    });
    if (!job) throw new NotFoundException('Backup job not found');
    return toWorkbookJobDto(job);
  }
}
