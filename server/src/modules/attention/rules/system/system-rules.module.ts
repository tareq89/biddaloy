import { Module } from '@nestjs/common';
import { SchoolsModule } from '../../../schools/schools.module';
import { CreditsModule } from '../../../communications/credits/credits.module';
import { CommsSmsCreditLowRule } from './comms-sms-credit-low.rule';
import { CommsFailedMessagesRule } from './comms-failed-messages.rule';
import { SystemBackupFailedRule } from './system-backup-failed.rule';

/** Rules of category SYSTEM. */
@Module({
  imports: [SchoolsModule, CreditsModule],
  providers: [CommsSmsCreditLowRule, CommsFailedMessagesRule, SystemBackupFailedRule],
})
export class SystemRulesModule {}
