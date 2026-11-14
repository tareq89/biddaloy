import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CommunicationsModule } from '../communications/communications.module';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { School } from '../schools/entities/school.entity';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { MoneyNoticesService } from './money-notices.service';

/** [Epic 100 #3875] Leaf module: money emails. Imports no money module, so PlansModule and BillingModule can both use it. */
@Module({
  imports: [CommunicationsModule, TypeOrmModule.forFeature([School, UserTenant, CommunicationLog])],
  // AdminNoticeService is stateless; provided here for the same cycle reason as in BillingModule.
  providers: [MoneyNoticesService, AdminNoticeService],
  exports: [MoneyNoticesService],
})
export class MoneyNoticesModule {}
