import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ExportFormat,
  JwtPayload,
  Permission,
  ReportRunKind,
  RoleScope,
  roleScope,
} from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ReportExportService } from '../export/report-export.service';
import {
  StudentCountDto,
  StudentCountExportQueryDto,
  StudentCountQueryDto,
} from './dto/student-count.dto';
import { StudentCountService } from './student-count.service';

/** A role narrowed to its own sections (a TEACHER) cannot see school-wide head counts. */
function assertSchoolWide(role: string): void {
  if (roleScope(role) === RoleScope.ASSIGNED_SECTIONS) throw new ForbiddenException();
}

/**
 * [8.15.53] The early BANBEIS student count (D23, temporary). `REPORTS_VIEW` opens it; the export
 * needs `REPORTS_EXPORT` as well. COMMITTEE can open it (counts only, cells under 5 hidden).
 */
@ApiTags('reports')
@ApiTenantAuth()
@Controller('reports/student-count')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentCountController {
  constructor(
    private readonly service: StudentCountService,
    private readonly reportExport: ReportExportService,
  ) {}

  @Get()
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Active students by class, gender and religion, and staff by type.' })
  @ApiOkResponse({ type: StudentCountDto })
  getCount(
    @Query() query: StudentCountQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<StudentCountDto> {
    assertSchoolWide(tenant.role);
    return this.service.getCount(tenant.id, tenant.role, query.academic_year_id);
  }

  @Get('export')
  @RequirePermissions(Permission.REPORTS_VIEW, Permission.REPORTS_EXPORT)
  @ApiOperation({ summary: 'The student count (or the staff count) as one Excel or CSV file.' })
  async export(
    @Query() query: StudentCountExportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<StreamableFile> {
    assertSchoolWide(tenant.role);
    const table = query.table ?? 'students';
    const { header, rows, filename } = await this.service.exportRows(
      tenant.id,
      tenant.role,
      table,
      query.academic_year_id,
    );
    return this.reportExport.export({
      tenantId: tenant.id,
      userId: user.sub,
      kind: ReportRunKind.EXPORT,
      format: query.format ?? ExportFormat.XLSX,
      sourceKey: `student-count-${table}`,
      params: { academic_year_id: query.academic_year_id ?? null, table },
      header,
      rows: (async function* () {
        for (const row of rows) yield row;
      })(),
      filename,
    });
  }
}
