import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { StaffAttendanceDashboardService } from './staff-attendance-dashboard.service';
import { StaffTodayWidgetDto } from './dto/staff-attendance-dashboard.dto';

@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StaffAttendanceDashboardController {
  constructor(private readonly service: StaffAttendanceDashboardService) {}

  @DashboardWidgetRoute(DashboardWidgetKey.STAFF_TODAY)
  @ApiOkResponse({ type: StaffTodayWidgetDto })
  getToday(@CurrentTenant() tenant: { id: string }): Promise<StaffTodayWidgetDto> {
    return this.service.getToday(tenant.id);
  }
}
