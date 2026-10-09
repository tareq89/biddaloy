import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { School } from '../entities/school.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { CommunicationsModule } from '../../communications/communications.module';
import { AuditModule } from '../../audit/audit.module';
import { AdminNoticeService } from './admin-notice.service';
import { TrialService } from './trial.service';
import { TrialScheduler } from './trial.scheduler';
import { TrialProcessor } from './trial.processor';
import { TRIAL_QUEUE } from './trial.constants';

/** Trial lifecycle [13.2.3]: warnings, end-of-trial suspension, extension, admin notices. */
@Module({
  imports: [
    TypeOrmModule.forFeature([School, UserTenant, CommunicationLog]),
    ConfigModule,
    AuditModule,
    CommunicationsModule,
    BullModule.registerQueue({ name: TRIAL_QUEUE }),
  ],
  providers: [AdminNoticeService, TrialService, TrialScheduler, TrialProcessor],
  exports: [AdminNoticeService, TrialService],
})
export class TrialModule {}
