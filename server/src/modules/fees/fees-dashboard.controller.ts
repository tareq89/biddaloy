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
import { DEFAULT_REGION_SETTINGS } from '../schools/settings/tenant-settings-defaults';
import { FeeDuesService } from './fee-dues.service';
import { FeeGenerationsService } from './fee-generations.service';
import { RecurringSchedulesService } from './recurring-schedules.service';
import { PaymentsQueryService } from './payments-query.service';
import {
  DuesAgeingWidgetDto,
  DuesByClassWidgetDto,
  FeeGenerationStatusWidgetDto,
  RecentPaymentsWidgetDto,
  RemindersPendingWidgetDto,
} from './dto/fees-dashboard.dto';

/**
 * Accountant dashboard widgets (Epic 169 D28/D46, #1867/#1868). School-wide
 * totals: the catalogue roles exclude TEACHER, so no teacher scoping applies.
 * Each loader reads "today" inside the cache loader, so a cached value is at
 * most 60 s stale.
 */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FeesDashboardController {
  constructor(
    private readonly dues: FeeDuesService,
    private readonly generations: FeeGenerationsService,
    private readonly schedules: RecurringSchedulesService,
    private readonly payments: PaymentsQueryService,
    private readonly schools: SchoolsService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.DUES_AGEING)
  @ApiOkResponse({ type: DuesAgeingWidgetDto })
  async duesAgeing(@CurrentTenant() tenant: { id: string }): Promise<DuesAgeingWidgetDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.DUES_AGEING, 'school', async () =>
      this.dues.getAgeing(tenant.id, await this.schools.todayFor(tenant.id)),
    );
  }

  @DashboardWidgetRoute(DashboardWidgetKey.DUES_BY_CLASS)
  @ApiOkResponse({ type: DuesByClassWidgetDto })
  async duesByClass(@CurrentTenant() tenant: { id: string }): Promise<DuesByClassWidgetDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.DUES_BY_CLASS, 'school', () =>
      this.dues.getDuesByClass(tenant.id),
    );
  }

  @DashboardWidgetRoute(DashboardWidgetKey.REMINDERS_PENDING)
  @ApiOkResponse({ type: RemindersPendingWidgetDto })
  async remindersPending(
    @CurrentTenant() tenant: { id: string },
  ): Promise<RemindersPendingWidgetDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.REMINDERS_PENDING,
      'school',
      async () => {
        const [today, settings] = await Promise.all([
          this.schools.todayFor(tenant.id),
          this.schools.getResolvedSettings(tenant.id),
        ]);
        const timezone = settings.region?.timezone ?? DEFAULT_REGION_SETTINGS.timezone;
        return this.dues.countRemindersPending(tenant.id, today, timezone);
      },
    );
  }

  @DashboardWidgetRoute(DashboardWidgetKey.FEE_GENERATION_STATUS)
  @ApiOkResponse({ type: FeeGenerationStatusWidgetDto })
  async feeGenerationStatus(
    @CurrentTenant() tenant: { id: string },
  ): Promise<FeeGenerationStatusWidgetDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.FEE_GENERATION_STATUS,
      'school',
      async () => {
        const today = await this.schools.todayFor(tenant.id);
        const [status, next_scheduled_run] = await Promise.all([
          this.generations.currentPeriodStatus(tenant.id, today),
          this.schedules.nextScheduledRun(tenant.id, today),
        ]);
        return { ...status, next_scheduled_run };
      },
    );
  }

  @DashboardWidgetRoute(DashboardWidgetKey.RECENT_PAYMENTS)
  @ApiOkResponse({ type: RecentPaymentsWidgetDto })
  async recentPayments(@CurrentTenant() tenant: { id: string }): Promise<RecentPaymentsWidgetDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.RECENT_PAYMENTS, 'school', () =>
      this.payments.findRecentWithClass(tenant.id),
    );
  }
}
