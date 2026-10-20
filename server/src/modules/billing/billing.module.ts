import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { BillingController } from './billing.controller';
import { BillingScheduler, BILLING_QUEUE } from './billing.scheduler';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';

/** Billing (Epic 49): seat orders, the entitlement that sets `schools.seat_limit`, the daily recompute. */
@Module({
  imports: [AuditModule, SchoolsModule, BullModule.registerQueue({ name: BILLING_QUEUE })],
  controllers: [BillingController],
  providers: [EntitlementService, OrdersService, BillingScheduler],
  exports: [EntitlementService, OrdersService],
})
export class BillingModule {}
