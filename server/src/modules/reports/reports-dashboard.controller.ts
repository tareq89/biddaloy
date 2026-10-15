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
import { CollectionsReportService } from './collections-report.service';
import { CollectionMonthWidgetDto } from './dto/collection-month-widget.dto';

/** `GET /dashboard/widgets/collection-month` (Epic 169 D25/D46). */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportsDashboardController {
  constructor(
    private readonly collectionsReport: CollectionsReportService,
    private readonly schools: SchoolsService,
    private readonly cache: DashboardCacheService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.COLLECTION_MONTH)
  @ApiOkResponse({ type: CollectionMonthWidgetDto })
  async collectionMonth(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CollectionMonthWidgetDto> {
    // The date is read inside the loader, so a cached value is at most 60 s stale.
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.COLLECTION_MONTH,
      'school',
      async () =>
        this.collectionsReport.getCollectionMonthWidget(
          tenant.id,
          await this.schools.todayFor(tenant.id),
        ),
    );
  }
}
