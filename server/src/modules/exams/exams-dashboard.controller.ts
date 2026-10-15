import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey, JwtPayload } from '@biddaloy/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { localToday } from '../../common/time';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { ExamsDashboardService } from './exams-dashboard.service';
import { MarkEntryProgressWidgetDto, MyMarkDeadlinesDto } from './dto/exams-dashboard.dto';

/** `GET /dashboard/widgets/mark-entry-progress` (Epic 169 D40/D46). */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ExamsDashboardController {
  constructor(
    private readonly dashboard: ExamsDashboardService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.MARK_ENTRY_PROGRESS)
  @ApiOkResponse({ type: MarkEntryProgressWidgetDto })
  markEntryProgress(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<MarkEntryProgressWidgetDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.MARK_ENTRY_PROGRESS, 'school', () =>
      this.dashboard.getMarkEntryProgress(tenant.id, localToday()),
    );
  }

  /** [8.10.7.3.03] Teacher's own grids; cached per user (the answer is personal). */
  @DashboardWidgetRoute(DashboardWidgetKey.MY_MARK_DEADLINES)
  @ApiOkResponse({ type: MyMarkDeadlinesDto })
  myMarkDeadlines(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<MyMarkDeadlinesDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.MY_MARK_DEADLINES,
      `user:${user.sub}`,
      () => this.dashboard.myMarkDeadlines(tenant.id, user.sub),
    );
  }
}
