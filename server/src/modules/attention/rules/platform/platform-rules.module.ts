import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsBundlesModule } from '../../../sms-bundles/sms-bundles.module';
import { PlatformIdentityModule } from '../../../platform-identity/platform-identity.module';
import { PlatformApprovalPendingRule } from './platform-approval-pending.rule';
import { PlatformRecoveryCodesLowRule } from './platform-recovery-codes-low.rule';
import { PlatformBackupFailingRule } from './platform-backup-failing.rule';
import { PlatformBkashRefundDueRule } from './platform-bkash-refund-due.rule';
import { PlatformProviderFailuresRule } from './platform-provider-failures.rule';
import { PlatformTenantResolver } from './platform-tenant';
import { PlatformLoginAsBurstRule } from './platform-login-as-burst.rule';
import { PlatformSmsOversoldRule } from './platform-sms-oversold.rule';
import { PlatformSmsStockLowRule } from './platform-sms-stock-low.rule';
import { PlatformSeatsExpiringRule } from './platform-seats-expiring.rule';

/** Rules of category PLATFORM (TenantStatusModule is @Global). */
@Module({
  imports: [ConfigModule, PlatformIdentityModule, SmsBundlesModule],
  providers: [
    PlatformTenantResolver,
    PlatformBackupFailingRule,
    PlatformSeatsExpiringRule,
    PlatformProviderFailuresRule,
    PlatformBkashRefundDueRule,
    PlatformLoginAsBurstRule,
    PlatformRecoveryCodesLowRule,
    PlatformApprovalPendingRule,
    PlatformSmsStockLowRule,
    PlatformSmsOversoldRule,
  ],
})
export class PlatformRulesModule {}
