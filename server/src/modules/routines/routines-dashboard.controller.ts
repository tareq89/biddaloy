import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey, JwtPayload } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { RoutinesDashboardService } from './routines-dashboard.service';
import { MyRoutineTodayDto } from './dto/routines-dashboard.dto';

/** [8.10.7.3.01] "My routine today" teacher widget. Cached per user (the answer is personal). */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class RoutinesDashboardController {
  constructor(
    private readonly service: RoutinesDashboardService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.MY_ROUTINE_TODAY)
  @ApiOkResponse({ type: MyRoutineTodayDto })
  getMyRoutineToday(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<MyRoutineTodayDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.MY_ROUTINE_TODAY,
      `user:${user.sub}`,
      () => this.service.myRoutineToday(tenant.id, { userId: user.sub, role: tenant.role }),
    );
  }
}
