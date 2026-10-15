import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { StudentsDashboardService } from './students-dashboard.service';
import { GuardiansIncompleteDto, StudentsAddedTodayDto } from './dto/students-dashboard.dto';

/** [8.10.7.4.13] Office-staff widgets. Role and permission come from the catalogue via the decorator. */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentsDashboardController {
  constructor(
    private readonly service: StudentsDashboardService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.GUARDIANS_INCOMPLETE)
  @ApiOkResponse({ type: GuardiansIncompleteDto })
  getGuardiansIncomplete(@CurrentTenant() tenant: { id: string }): Promise<GuardiansIncompleteDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.GUARDIANS_INCOMPLETE, 'school', () =>
      this.service.getGuardiansIncomplete(tenant.id),
    );
  }

  @DashboardWidgetRoute(DashboardWidgetKey.STUDENTS_ADDED_TODAY)
  @ApiOkResponse({ type: StudentsAddedTodayDto })
  getStudentsAddedToday(@CurrentTenant() tenant: { id: string }): Promise<StudentsAddedTodayDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.STUDENTS_ADDED_TODAY, 'school', () =>
      this.service.getStudentsAddedToday(tenant.id),
    );
  }
}
