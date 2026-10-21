import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../entities/school.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { CommunicationsModule } from '../../communications/communications.module';
import { AuditModule } from '../../audit/audit.module';
import { AdminNoticeService } from './admin-notice.service';
import { TrialService } from './trial.service';
import { BillingModule } from '../../billing/billing.module';

/** Account start, platform seat grants and admin notices (the trial is retired, Epic 49). */
@Module({
  imports: [
    TypeOrmModule.forFeature([School, UserTenant, CommunicationLog]),
    ConfigModule,
    AuditModule,
    CommunicationsModule,
    BillingModule,
  ],
  providers: [AdminNoticeService, TrialService],
  exports: [AdminNoticeService, TrialService],
})
export class TrialModule {}
