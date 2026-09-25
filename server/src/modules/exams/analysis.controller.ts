import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Readable } from 'stream';
import { IsNull, Repository } from 'typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole, toCsvContent } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AnalysisQueryDto } from './dto/analysis.dto';
import {
  AnalysisService,
  DefaultedRow,
  MeritRow,
  OverallPassFailRow,
  SubjectPassFailRow,
} from './analysis.service';
import { Exam } from './entities/exam.entity';

const MERIT_CSV_HEADER = [
  'Roll',
  'Name',
  'Section',
  'Total Marks',
  'GPA',
  'Grade',
  'Position',
  'Section Position',
  'Fail',
];

function meritToCsv(rows: MeritRow[]): string {
  const body = rows.map((r) => [
    r.roll_number,
    r.full_name,
    r.section_name ?? '',
    r.total_marks,
    r.gpa,
    r.grade,
    r.position ?? '',
    r.section_position ?? '',
    r.is_fail ? 'Yes' : 'No',
  ]);
  return toCsvContent([MERIT_CSV_HEADER, ...body]);
}

const DEFAULTED_CSV_HEADER = [
  'Roll',
  'Name',
  'Section',
  'Total Marks',
  'GPA',
  'Grade',
  'Fail',
  'Failed Subjects',
  'Absent Subjects',
];

function defaultedToCsv(rows: DefaultedRow[]): string {
  const body = rows.map((r) => [
    r.roll_number,
    r.full_name,
    r.section_name ?? '',
    r.total_marks,
    r.gpa,
    r.grade,
    r.is_fail ? 'Yes' : 'No',
    r.failed_subjects.map((s) => s.name).join('; '),
    r.absent_subjects.map((s) => s.name).join('; '),
  ]);
  return toCsvContent([DEFAULTED_CSV_HEADER, ...body]);
}

const PASS_FAIL_CSV_HEADER = [
  'Subject',
  'Appeared',
  'Passed',
  'Failed',
  'Absent',
  'Pass %',
  'Highest',
  'Average',
];

function passFailToCsv(subjects: SubjectPassFailRow[], overall: OverallPassFailRow): string {
  const body = [...subjects, overall].map((r) => [
    r.subject_name,
    r.appeared,
    r.passed,
    r.failed,
    r.absent,
    r.pass_pct,
    r.highest ?? '',
    r.average ?? '',
  ]);
  return toCsvContent([PASS_FAIL_CSV_HEADER, ...body]);
}

/**
 * [997] `GET /exams/:examId/analysis/*` — read-only merit/defaulted/
 * pass-fail/components views for a processed exam, each also available as
 * CSV. Cloning `marks.controller.ts:45-47`'s two-layer gate: `@Roles` is
 * the coarse "may attempt this at all" check, `MARK_VIEW` the fine one.
 * No writes anywhere in this controller (issue step 7's invariant).
 */
@ApiTags('exams')
@ApiTenantAuth()
@Controller('exams/:examId/analysis')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
  ) {}

  private async examName(examId: string, tenantId: string): Promise<string> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) throw new NotFoundException(`Exam with ID "${examId}" not found`);
    return exam.name;
  }

  @Get('merit')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Merit list for an exam, optionally section-scoped.' })
  getMerit(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.analysisService.getMerit(examId, tenant.id, query.section_id);
  }

  @Get('defaulted')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Defaulted (failed or absent) students for an exam.' })
  getDefaulted(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.analysisService.getDefaulted(examId, tenant.id, query.section_id);
  }

  @Get('pass-fail')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Per-subject pass/fail breakdown for an exam.' })
  getPassFail(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.analysisService.getPassFail(examId, tenant.id, query.section_id);
  }

  @Get('pass-fail/components')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Per-subject × component pass/fail breakdown for an exam.' })
  getPassFailComponents(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.analysisService.getPassFailComponents(examId, tenant.id, query.section_id);
  }

  @Get('merit.csv')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Merit list as CSV.' })
  async getMeritCsv(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const [name, { rows }] = await Promise.all([
      this.examName(examId, tenant.id),
      this.analysisService.getMerit(examId, tenant.id, query.section_id),
    ]);
    // `res.attachment` (Express, via the `content-disposition` package) emits
    // an ASCII-safe `filename` fallback plus an RFC 5987 `filename*` value
    // and escapes quotes — a raw `name` here would otherwise throw
    // `ERR_INVALID_CHAR` for any Bengali exam name (this app ships a `bn`
    // locale). Must come before the Content-Type header: `attachment()` also
    // sets Content-Type, so the explicit charset header has to win by going
    // second.
    res.attachment(`${name}-merit.csv`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return new StreamableFile(Readable.from(Buffer.from(meritToCsv(rows), 'utf-8')));
  }

  @Get('defaulted.csv')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Defaulted list as CSV.' })
  async getDefaultedCsv(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const [name, { rows }] = await Promise.all([
      this.examName(examId, tenant.id),
      this.analysisService.getDefaulted(examId, tenant.id, query.section_id),
    ]);
    // See getMeritCsv's comment: attachment() first for the ASCII-safe
    // filename fallback, then the explicit Content-Type.
    res.attachment(`${name}-defaulted.csv`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return new StreamableFile(Readable.from(Buffer.from(defaultedToCsv(rows), 'utf-8')));
  }

  @Get('pass-fail.csv')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Per-subject pass/fail breakdown as CSV.' })
  async getPassFailCsv(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const [name, { subjects, overall }] = await Promise.all([
      this.examName(examId, tenant.id),
      this.analysisService.getPassFail(examId, tenant.id, query.section_id),
    ]);
    // See getMeritCsv's comment: attachment() first for the ASCII-safe
    // filename fallback, then the explicit Content-Type.
    res.attachment(`${name}-pass-fail.csv`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return new StreamableFile(
      Readable.from(Buffer.from(passFailToCsv(subjects, overall), 'utf-8')),
    );
  }
}
