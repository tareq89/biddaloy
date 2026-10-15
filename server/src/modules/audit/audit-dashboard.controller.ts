import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { AuditService } from './audit.service';
import { RecentActivityDto } from './dto/audit-dashboard.dto';

@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AuditDashboardController {
  constructor(
    private readonly audit: AuditService,
    private readonly cache: DashboardCacheService,
  ) {}

  /** Cached per user (not per school): `findAll` hides the caller's own ACR rows. */
  @DashboardWidgetRoute(DashboardWidgetKey.RECENT_ACTIVITY)
  @ApiOkResponse({ type: RecentActivityDto })
  getRecentActivity(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<RecentActivityDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.RECENT_ACTIVITY,
      `user:${user.sub}`,
      () => this.audit.findRecentForDashboard(tenant.id, user.sub),
    );
  }
}
