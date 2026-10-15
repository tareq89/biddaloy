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
import { SchoolsService } from '../schools/schools.service';
import { SeatPlansDashboardService } from './seat-plans-dashboard.service';
import { SeatPlanStatusDto } from './dto/seat-plans-dashboard.dto';

/** `GET /dashboard/widgets/seat-plan-status` (Epic 169 D35/D46). */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SeatPlansDashboardController {
  constructor(
    private readonly dashboard: SeatPlansDashboardService,
    private readonly cache: DashboardCacheService,
    private readonly schools: SchoolsService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.SEAT_PLAN_STATUS)
  @ApiOkResponse({ type: SeatPlanStatusDto })
  status(@CurrentTenant() tenant: { id: string; role: string }): Promise<SeatPlanStatusDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.SEAT_PLAN_STATUS,
      'school',
      async () => this.dashboard.getStatus(tenant.id, await this.schools.todayFor(tenant.id)),
    );
  }
}
