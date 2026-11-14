import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MoneyNoticesModule } from '../billing/money-notices.module';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { PlatformPlansController } from './platform-plans.controller';
import { PlansService } from './plans.service';

/** [Epic 100 #3875] Plans: platform CRUD plus the service BillingModule prices orders with. */
@Module({
  imports: [AuditModule, MoneyNoticesModule, PlatformIdentityModule],
  controllers: [PlatformPlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
