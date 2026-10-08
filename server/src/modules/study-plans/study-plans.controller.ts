import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { StudyPlanCaller, StudyPlansService } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';
import { CsvFile, StudyPlanCsvService } from './study-plan-csv.service';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import {
  CommitStudyPlanImportDto,
  ProgressCsvQueryDto,
  StudyPlanImportValidateResultDto,
  ValidateStudyPlanImportDto,
} from './dto/study-plan-import.dto';
import {
  CopyToSectionDto,
  CreateStudyPlanDto,
  ReplaceLessonsDto,
  SetExamMarkersDto,
  UpdateStudyPlanDto,
} from './dto/study-plan.dto';
import {
  CarryOverResponseDto,
  ListStudyPlansWithSummaryQueryDto,
  PlanCapacityQueryDto,
  PlanCapacityResponseDto,
  PlanScheduleResponseDto,
} from './dto/plan-schedule.dto';

type Tenant = { id: string; role: string };

const IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Express `attachment()` gives an ASCII-safe filename (Bangla names); Content-Type goes second so it wins. */
function sendCsv(res: Response, file: CsvFile): StreamableFile {
  res.attachment(file.filename);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  return new StreamableFile(Readable.from(Buffer.from(file.csv, 'utf-8')));
}

/**
 * [66.2.01/#2006] Study plan routes. Permission guards only say "may use the
 * feature"; the owner scope (D6/D28) is enforced in `StudyPlansService`.
 * Literal paths must stay above `:id` (the `/routines/:id` shadowing bug).
 */
@ApiTags('study-plans')
@ApiTenantAuth()
@Controller('study-plans')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudyPlansController {
  constructor(
    private readonly service: StudyPlansService,
    private readonly schedule: PlanScheduleService,
    private readonly csv: StudyPlanCsvService,
  ) {}

  private caller(tenant: Tenant, user: JwtPayload, request: Request): StudyPlanCaller {
    return {
      userId: user.sub,
      tenantId: tenant.id,
      role: tenant.role,
      context: requestContext(request),
    };
  }

  @Get()
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'List study plans the caller can read.' })
  list(
    @Query() query: ListStudyPlansWithSummaryQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.schedule.listWithSummary(query, tenant.id, this.caller(tenant, user, request));
  }

  @Get('capacity')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'Periods left for a section, subject and term, before a plan exists.' })
  @ApiOkResponse({ type: PlanCapacityResponseDto })
  capacity(
    @Query() query: PlanCapacityQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.schedule.capacityForCaller(
      tenant.id,
      this.caller(tenant, user, request),
      query.section_id,
      query.subject_id,
      query.academic_term_id ?? null,
    );
  }

  @Get('progress.csv')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({
    summary: 'Progress of every plan of a class and term as CSV (admin, executive).',
  })
  async progressCsv(
    @Query() query: ProgressCsvQueryDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return sendCsv(
      res,
      await this.csv.progressCsv(query, tenant.id, this.caller(tenant, user, request)),
    );
  }

  @Post('import/validate')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_FILE_SIZE } }))
  @ApiOperation({
    summary:
      'Validate a lessons CSV/XLSX (max 5MB) for a plan (class_id + subject_id) or a template (class_grade + subject_code) and stage it. Writes nothing.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse({ type: StudyPlanImportValidateResultDto })
  importValidate(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ValidateStudyPlanImportDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.csv.validate(file, body, tenant.id, this.caller(tenant, user, request));
  }

  @Post('import/commit')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Commit a validated import into a plan, a new plan or a new template (once).',
  })
  importCommit(
    @Body() dto: CommitStudyPlanImportDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.csv.commit(dto, tenant.id, this.caller(tenant, user, request));
  }

  @Post()
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Create a study plan for a section and subject.' })
  create(
    @Body() dto: CreateStudyPlanDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(dto, tenant.id, this.caller(tenant, user, request));
  }

  @Get(':id')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'Read one study plan with owners and exam markers.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.findOneForCaller(id, tenant.id, this.caller(tenant, user, request));
  }

  @Get(':id/schedule')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'Dated schedule: expected date and status of every lesson.' })
  @ApiOkResponse({ type: PlanScheduleResponseDto })
  getSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.schedule.getSchedule(id, tenant.id, this.caller(tenant, user, request));
  }

  @Get(':id/lessons.csv')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'Download the lesson list as CSV (title, periods, topic, notes).' })
  async lessonsCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return sendCsv(
      res,
      await this.csv.exportLessons(id, tenant.id, this.caller(tenant, user, request)),
    );
  }

  @Get(':id/carry-over')
  @RequirePermissions(Permission.SYLLABUS_READ)
  @ApiOperation({ summary: 'Lessons not finished, for the next term plan.' })
  @ApiOkResponse({ type: CarryOverResponseDto })
  carryOver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.schedule.carryOver(id, tenant.id, this.caller(tenant, user, request));
  }

  @Patch(':id')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Reassign the plan owner (administrator only).' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyPlanDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.setOwnerOverride(
      id,
      dto.owner_override_teacher_id,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a study plan.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.service.remove(id, tenant.id, this.caller(tenant, user, request));
  }

  @Put(':id/lessons')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Replace the whole ordered lesson list.' })
  replaceLessons(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceLessonsDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.replaceLessons(
      id,
      dto.lessons,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }

  @Put(':id/exam-markers')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Set the exam markers (one per exam).' })
  setExamMarkers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExamMarkersDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.setExamMarkers(
      id,
      dto.markers,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }

  @Post(':id/copy-to-section')
  @RequirePermissions(Permission.SYLLABUS_MANAGE)
  @ApiOperation({ summary: 'Copy this plan to another section of the same year.' })
  copyToSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopyToSectionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.copyToSection(
      id,
      dto.section_id,
      tenant.id,
      this.caller(tenant, user, request),
    );
  }
}
