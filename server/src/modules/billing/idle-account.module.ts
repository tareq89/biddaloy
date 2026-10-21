import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { TrialModule } from '../schools/trial/trial.module';
import { IDLE_QUEUE, IdleAccountScheduler } from './idle-account.scheduler';
import { IdleAccountService } from './idle-account.service';

/**
 * Own module, not part of BillingModule: TrialModule imports BillingModule, and this needs
 * AdminNoticeService from TrialModule. TenantStatusService and SessionCutoffService are @Global.
 */
@Module({
  imports: [
    AuditModule,
    SchoolsModule,
    TrialModule,
    BullModule.registerQueue({ name: IDLE_QUEUE }),
  ],
  providers: [IdleAccountService, IdleAccountScheduler],
})
export class IdleAccountModule {}
