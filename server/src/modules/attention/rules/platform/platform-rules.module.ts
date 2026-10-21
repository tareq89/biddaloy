import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PlatformBackupFailingRule } from './platform-backup-failing.rule';
import { PlatformBkashRefundDueRule } from './platform-bkash-refund-due.rule';
import { PlatformProviderFailuresRule } from './platform-provider-failures.rule';
import { PlatformTenantResolver } from './platform-tenant';
import { PlatformSeatsExpiringRule } from './platform-seats-expiring.rule';

/** Rules of category PLATFORM (TenantStatusModule is @Global). */
@Module({
  imports: [ConfigModule],
  providers: [
    PlatformTenantResolver,
    PlatformBackupFailingRule,
    PlatformSeatsExpiringRule,
    PlatformProviderFailuresRule,
    PlatformBkashRefundDueRule,
  ],
})
export class PlatformRulesModule {}
