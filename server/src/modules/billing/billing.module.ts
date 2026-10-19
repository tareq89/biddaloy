import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { SchoolsModule } from '../schools/schools.module';
import { BillingController } from './billing.controller';
import { BillingScheduler, BILLING_QUEUE } from './billing.scheduler';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';
import { SeatNoticesService } from './seat-notices.service';

/** Billing (Epic 49): seat orders, the entitlement that sets `schools.seat_limit`, the daily recompute. */
@Module({
  imports: [
    AuditModule,
    SchoolsModule,
    CommunicationsModule,
    TypeOrmModule.forFeature([School, UserTenant, CommunicationLog]),
    BullModule.registerQueue({ name: BILLING_QUEUE }),
  ],
  controllers: [BillingController],
  // AdminNoticeService is provided here as well as in TrialModule: TrialModule imports this module,
  // so importing it back would be a cycle. The service is stateless.
  providers: [
    EntitlementService,
    OrdersService,
    BillingScheduler,
    SeatNoticesService,
    AdminNoticeService,
  ],
  exports: [EntitlementService, OrdersService],
})
export class BillingModule {}
