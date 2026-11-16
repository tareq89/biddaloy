import { RequiresModule } from '../auth/decorators/require-module.decorator';
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, ModuleKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AdmissionReportsService } from './admission-reports.service';
import {
  AdmissionExportParamsDto,
  FunnelReportDto,
  FunnelReportQueryDto,
  LifecycleReportDto,
  LifecycleReportQueryDto,
} from './dto/admission-reports.dto';

/** [39.5.1] Same guard stack as `ApplicantReviewController`, gated on the lifecycle permission (D22). */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission/reports')
@RequiresModule(ModuleKey.admission)
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.STUDENT_LIFECYCLE_MANAGE)
export class AdmissionReportsController {
  constructor(private readonly reports: AdmissionReportsService) {}

  @Get('lifecycle')
  @ApiOperation({
    summary:
      'Admitted / withdrawn / transferred out / graduated / readmitted counts and rows for an academic year.',
  })
  @ApiOkResponse({ type: LifecycleReportDto })
  lifecycle(
    @Query() query: LifecycleReportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.reports.lifecycle(tenant.id, query);
  }

  @Get('funnel')
  @RequirePermissions(Permission.ADMISSION_REVIEW)
  @ApiOperation({
    summary:
      'Applied to admitted funnel, ONLINE/CLERK split and quota counts for an academic year.',
  })
  @ApiOkResponse({ type: FunnelReportDto })
  funnel(
    @Query() query: FunnelReportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.reports.funnel(tenant.id, query);
  }

  @Get('export/:kind')
  @RequirePermissions(Permission.ADMISSION_REVIEW)
  @ApiOperation({ summary: 'Download applicants, stage scores or lists as .xlsx.' })
  @ApiOkResponse({
    description: 'The workbook.',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async exportKind(
    @Param() params: AdmissionExportParamsDto,
    @Query() query: FunnelReportQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.reports.exportKind(tenant.id, params.kind, query);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="admission-${params.kind}.xlsx"`);
    res.send(buffer);
  }
}
