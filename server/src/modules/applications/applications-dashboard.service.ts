import { Injectable } from '@nestjs/common';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { ApplicationReportsService } from './application-reports.service';
import type { ApplicationCaller } from './reviewer-scope';
import type { PendingCountDto } from './dto/reports.dto';

/**
 * "Waiting for your approval" widget (ADMIN, EXECUTIVE). Not a second query: it is
 * `pendingCount`, i.e. the `view=inbox` predicate, so the card always equals the inbox.
 */
@Injectable()
export class ApplicationsDashboardService {
  constructor(
    private readonly reports: ApplicationReportsService,
    private readonly cache: DashboardCacheService,
  ) {}

  getApprovalsPending(tenantId: string, caller: ApplicationCaller): Promise<PendingCountDto> {
    return this.cache.getOrLoad(
      tenantId,
      DashboardWidgetKey.APPROVALS_PENDING,
      `user:${caller.userId}`, // counts differ per reviewer
      () => this.reports.pendingCount(tenantId, caller),
    );
  }
}
