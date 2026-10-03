import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AdmissionReportsService } from './admission-reports.service';
import { LifecycleReportDto, LifecycleReportQueryDto } from './dto/admission-reports.dto';

/** [39.5.1] Same guard stack as `ApplicantReviewController`, gated on the lifecycle permission (D22). */
@ApiTags('admission')
@ApiTenantAuth()
@Controller('admission/reports')
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
}
