import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey, JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { LeaveService } from './leave.service';
import { MyLeaveBalanceDto } from './dto/leave-dashboard.dto';

/** [8.10.7.3.05] "My leave balance" widget. Cached per user (the answer is personal). */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class LeaveDashboardController {
  constructor(
    private readonly leave: LeaveService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.MY_LEAVE_BALANCE)
  @ApiOkResponse({ type: MyLeaveBalanceDto })
  getMyLeaveBalance(
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: JwtPayload,
  ): Promise<MyLeaveBalanceDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.MY_LEAVE_BALANCE,
      `user:${user.sub}`,
      () => this.leave.getOwnBalances(tenant.id, user.sub, tenant.role),
    );
  }
}
