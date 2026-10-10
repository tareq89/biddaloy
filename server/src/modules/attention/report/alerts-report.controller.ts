import { Controller, Get, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { AlertsReportService } from './alerts-report.service';
import { AlertsReportDto, AlertsReportQueryDto } from './dto/alerts-report.dto';

@ApiTags('attention')
@ApiTenantAuth()
@Controller('attention/report')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
// ALERT_REPORT_READ is held by exactly ADMIN and EXECUTIVE (a @Roles here would only duplicate the map)
@RequirePermissions(Permission.ALERT_REPORT_READ)
export class AlertsReportController {
  constructor(private readonly report: AlertsReportService) {}

  @Get()
  @ApiOperation({
    summary: 'Monthly rule-alert counts per rule and section (JSON, or CSV with format=csv).',
  })
  @ApiOkResponse({ type: AlertsReportDto })
  async get(
    @CurrentTenant() tenant: { id: string },
    @Query() query: AlertsReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AlertsReportDto | StreamableFile> {
    const report = await this.report.getReport(tenant.id, query);
    if (query.format !== 'csv') return report;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="alerts-report-${report.month}.csv"`,
    });
    return new StreamableFile(Buffer.from(this.report.toCsv(report), 'utf-8'));
  }
}
