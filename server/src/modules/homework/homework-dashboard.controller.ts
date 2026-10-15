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
import { SyllabusService } from './syllabus.service';
import { SyllabusProgressWidgetDto } from './dto/homework-dashboard.dto';

/** [8.10.7.2.05] "Syllabus progress" widget. Done % only; the expected-by-today marker waits for #1828. */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class HomeworkDashboardController {
  constructor(
    private readonly syllabus: SyllabusService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.SYLLABUS_PROGRESS)
  @ApiOkResponse({ type: SyllabusProgressWidgetDto })
  getSyllabusProgress(@CurrentTenant() tenant: { id: string }): Promise<SyllabusProgressWidgetDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.SYLLABUS_PROGRESS, 'school', () =>
      this.syllabus.progressByClass(tenant.id),
    );
  }
}
