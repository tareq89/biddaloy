import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { DashboardCacheService } from '../../dashboard/dashboard-cache.service';
import { DashboardWidgetRoute } from '../../dashboard/widget-permission.decorator';
import { PrintHistoryService } from './print-history.service';
import { PrintQueueWidgetDto } from './dto/print-dashboard.dto';

/**
 * `GET /dashboard/widgets/print-queue` ([8.10.7.7.02]). Not a second query: it is the
 * to-print queue tab's own `queueCounts`, so the card equals the queue.
 */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PrintDashboardController {
  constructor(
    private readonly history: PrintHistoryService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.PRINT_QUEUE)
  @ApiOkResponse({ type: PrintQueueWidgetDto })
  queue(@CurrentTenant() tenant: { id: string }): Promise<PrintQueueWidgetDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.PRINT_QUEUE, 'school', async () => {
      const { total, by_kind } = await this.history.queueCounts(tenant.id);
      return { total, by_kind } as PrintQueueWidgetDto;
    });
  }
}
