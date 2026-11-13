import { Module } from '@nestjs/common';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';

/** [Epic 100 #3873] Owner revenue report (`platform/money`). */
@Module({
  imports: [PlatformIdentityModule],
  controllers: [RevenueController],
  providers: [RevenueService],
})
export class RevenueModule {}
