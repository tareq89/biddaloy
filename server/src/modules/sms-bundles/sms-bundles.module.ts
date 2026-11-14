import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CreditsModule } from '../communications/credits/credits.module';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { PlatformSmsCatalogController } from './catalog/platform-sms-catalog.controller';
import { SmsBundleCatalogService } from './catalog/sms-bundle-catalog.service';
import { SMS_EXPIRY_QUEUE, SmsExpiryScheduler } from './expiry/sms-expiry.scheduler';
import { SmsExpiryService } from './expiry/sms-expiry.service';
import { SmsBundleOrderSweepService } from './orders/sms-bundle-order-sweep.service';
import { SmsBundleOrdersController } from './orders/sms-bundle-orders.controller';
import { SmsBundleOrdersService } from './orders/sms-bundle-orders.service';
import { SmsBundlePayController } from './payment/sms-bundle-pay.controller';
import { SmsBundlePaymentService } from './payment/sms-bundle-payment.service';
import { SmsBundleReceiptController } from './receipts/sms-bundle-receipt.controller';
import { PlatformSmsReportController } from './report/platform-sms-report.controller';
import { SmsStateReportService } from './report/sms-state-report.service';
import { PlatformSmsStockController } from './stock/platform-sms-stock.controller';
import { ProviderBalanceReader } from './stock/provider-balance.reader';
import { SmsAllocationService } from './stock/sms-allocation.service';
import { SmsStockService } from './stock/sms-stock.service';

/** [Epic 100 W2] SMS bundles: catalog, orders, payment, receipts, stock and the daily expiry job. */
@Module({
  imports: [
    AuditModule,
    BillingModule, // BkashService, ReceiptService, AdminNoticeService
    CommunicationsModule, // MessagingConfigResolver
    CreditsModule, // SmsCreditService
    PlatformIdentityModule, // PlatformHomeService + the platform guard
    BullModule.registerQueue({ name: SMS_EXPIRY_QUEUE }),
  ],
  controllers: [
    PlatformSmsCatalogController,
    PlatformSmsStockController,
    PlatformSmsReportController,
    SmsBundleOrdersController,
    SmsBundlePayController,
    SmsBundleReceiptController,
  ],
  providers: [
    SmsStockService,
    ProviderBalanceReader,
    SmsAllocationService,
    SmsStateReportService,
    SmsBundleCatalogService,
    SmsBundleOrdersService,
    SmsBundleOrderSweepService,
    SmsBundlePaymentService,
    SmsExpiryService,
    SmsExpiryScheduler,
  ],
  exports: [SmsBundleCatalogService, SmsBundleOrdersService, SmsStockService],
})
export class SmsBundlesModule {}
