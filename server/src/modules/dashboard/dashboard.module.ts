import { Module } from '@nestjs/common';
import { DashboardCacheService } from './dashboard-cache.service';

/**
 * Shared plumbing for dashboard widgets (D29): no controller, no data. Owner
 * modules import this and inject `DashboardCacheService`. The briefing is not
 * here: it is `GET /attention/summary` (Epic 67 D1).
 */
@Module({
  providers: [DashboardCacheService],
  exports: [DashboardCacheService],
})
export class DashboardModule {}
