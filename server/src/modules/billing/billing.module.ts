import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountAccessModule } from '../account-access/account-access.module';
import { AuditModule } from '../audit/audit.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { SchoolsModule } from '../schools/schools.module';
import { BkashCallbackController } from './bkash/bkash.controller';
import { BkashClient } from './bkash/bkash.client';
import { BKASH_RECONCILE_QUEUE, BkashReconciler } from './bkash/bkash.reconciler';
import { BkashService } from './bkash/bkash.service';
import { BillingController } from './billing.controller';
import { BillingScheduler, BILLING_QUEUE } from './billing.scheduler';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';
import { ReceiptService } from './receipt.service';
import { PlatformBillingController } from './platform-billing.controller';
import { PlatformBillingService } from './platform-billing.service';
import { SeatNoticesService } from './seat-notices.service';

/** Billing (Epic 49): seat orders, the entitlement that sets `schools.seat_limit`, the daily recompute. */
@Module({
  imports: [
    AccountAccessModule, // OTP_REDIS: the bKash token cache
    AuditModule,
    SchoolsModule,
    CommunicationsModule,
    TypeOrmModule.forFeature([School, UserTenant, CommunicationLog]),
    BullModule.registerQueue({ name: BILLING_QUEUE }, { name: BKASH_RECONCILE_QUEUE }),
  ],
  controllers: [BillingController, BkashCallbackController, PlatformBillingController],
  // AdminNoticeService is provided here as well as in TrialModule: TrialModule imports this module,
  // so importing it back would be a cycle. The service is stateless.
  providers: [
    EntitlementService,
    OrdersService,
    ReceiptService,
    PlatformBillingService,
    BillingScheduler,
    SeatNoticesService,
    AdminNoticeService,
    BkashClient,
    BkashService,
    BkashReconciler,
  ],
  exports: [EntitlementService, OrdersService],
})
export class BillingModule {}
