import { forwardRef, Module } from '@nestjs/common';
import { SchoolsModule } from '../../../schools/schools.module';
import { CreditsModule } from '../../../communications/credits/credits.module';
import { CommunicationsModule } from '../../../communications/communications.module';
import { CommsDailyLimitReachedRule } from './comms-daily-limit-reached.rule';
import { CommsSmsCreditLowRule } from './comms-sms-credit-low.rule';
import { CommsSmsLowRule } from './comms-sms-low.rule';
import { CommsSmsExpiringRule } from './comms-sms-expiring.rule';
import { CommsFailedMessagesRule } from './comms-failed-messages.rule';
import { SystemBackupFailedRule } from './system-backup-failed.rule';

/** Rules of category SYSTEM. */
@Module({
  imports: [SchoolsModule, CreditsModule, forwardRef(() => CommunicationsModule)],
  providers: [
    CommsSmsCreditLowRule,
    CommsDailyLimitReachedRule,
    CommsSmsLowRule,
    CommsSmsExpiringRule,
    CommsFailedMessagesRule,
    SystemBackupFailedRule,
  ],
})
export class SystemRulesModule {}
