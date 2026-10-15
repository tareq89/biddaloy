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
import { AttendanceDashboardService } from './attendance-dashboard.service';
import {
  AttendanceTodayWidgetDto,
  ClassTeacherStreaksDto,
  MyPendingSectionsDto,
} from './dto/attendance-dashboard.dto';

@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AttendanceDashboardController {
  constructor(private readonly service: AttendanceDashboardService) {}

  @DashboardWidgetRoute(DashboardWidgetKey.ATTENDANCE_TODAY)
  @ApiOkResponse({ type: AttendanceTodayWidgetDto })
  getToday(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ): Promise<AttendanceTodayWidgetDto> {
    return this.service.getToday(tenant.id, tenant.role, user.sub);
  }

  @DashboardWidgetRoute(DashboardWidgetKey.MY_PENDING_SECTIONS)
  @ApiOkResponse({ type: MyPendingSectionsDto })
  getMyPendingSections(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ): Promise<MyPendingSectionsDto> {
    return this.service.myPendingSections(tenant.id, tenant.role, user.sub);
  }

  @DashboardWidgetRoute(DashboardWidgetKey.CLASS_TEACHER_STREAKS)
  @ApiOkResponse({ type: ClassTeacherStreaksDto })
  getClassTeacherStreaks(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<ClassTeacherStreaksDto> {
    return this.service.classTeacherStreaks(tenant.id, user.sub);
  }
}
