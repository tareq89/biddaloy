import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { EnrollmentsDashboardService } from './enrollments-dashboard.service';
import { CommitteeEnrollmentDto } from './dto/enrollments-dashboard.dto';

/** `GET /dashboard/widgets/committee-enrollment` (Epic 169 D16/D24/D46): aggregate only, no PII. */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class EnrollmentsDashboardController {
  constructor(
    private readonly service: EnrollmentsDashboardService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.COMMITTEE_ENROLLMENT)
  @ApiOkResponse({ type: CommitteeEnrollmentDto })
  committeeEnrollment(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CommitteeEnrollmentDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.COMMITTEE_ENROLLMENT,
      'school',
      () => this.service.getEnrollmentTrend(tenant.id),
    );
  }
}
