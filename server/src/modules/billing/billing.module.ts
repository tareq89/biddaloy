import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountAccessModule } from '../account-access/account-access.module';
import { AuditModule } from '../audit/audit.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PlansService } from '../plans/plans.service';
import { CreditsModule } from '../communications/credits/credits.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
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
import { RefundService } from './refund.service';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformVatController } from './platform-vat.controller';
import { MoneyNoticesService } from './money-notices.service';
import { VatService } from './vat.service';
import { SeatNoticesService } from './seat-notices.service';

/** Billing (Epic 49): seat orders, the entitlement that sets `schools.seat_limit`, the daily recompute. */
@Module({
  imports: [
    AccountAccessModule, // OTP_REDIS: the bKash token cache
    AuditModule,
    CouponsModule, // CouponRedemptionService for OrdersService
    PlatformIdentityModule, // PlatformSettingsService for VatService
    SchoolsModule,
    CommunicationsModule,
    CreditsModule, // SmsCreditService for RefundService
    TypeOrmModule.forFeature([School, UserTenant, CommunicationLog]),
    BullModule.registerQueue({ name: BILLING_QUEUE }, { name: BKASH_RECONCILE_QUEUE }),
  ],
  controllers: [
    BillingController,
    BkashCallbackController,
    PlatformBillingController,
    PlatformVatController,
  ],
  // AdminNoticeService is provided here as well as in TrialModule: TrialModule imports this module,
  // so importing it back would be a cycle. The service is stateless.
  providers: [
    EntitlementService,
    OrdersService,
    ReceiptService,
    VatService,
    // ponytail: provided here until #3875 wires a leaf module (PlansService needs MoneyNoticesService; a PlansModule import would cycle).
    PlansService,
    MoneyNoticesService,
    PlatformBillingService,
    RefundService,
    BillingScheduler,
    SeatNoticesService,
    AdminNoticeService,
    BkashClient,
    BkashService,
    BkashReconciler,
  ],
  exports: [
    EntitlementService,
    OrdersService,
    BkashService,
    ReceiptService,
    AdminNoticeService,
    VatService,
  ],
})
export class BillingModule {}
