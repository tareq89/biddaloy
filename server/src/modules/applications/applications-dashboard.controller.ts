import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { ApplicationsDashboardService } from './applications-dashboard.service';
import { PendingCountDto } from './dto/reports.dto';

@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ApplicationsDashboardController {
  constructor(private readonly service: ApplicationsDashboardService) {}

  @DashboardWidgetRoute(DashboardWidgetKey.APPROVALS_PENDING)
  @ApiOkResponse({ type: PendingCountDto })
  getApprovalsPending(
    @CurrentTenant() tenant: { id: string; role: UserRole },
    @CurrentUser() user: { sub: string },
  ): Promise<PendingCountDto> {
    return this.service.getApprovalsPending(tenant.id, { userId: user.sub, role: tenant.role });
  }
}
