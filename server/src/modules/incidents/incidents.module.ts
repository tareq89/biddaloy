import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffIncident } from './entities/staff-incident.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { AuditModule } from '../audit/audit.module';
import { PushModule } from '../push/push.module';
import { CommunicationsModule } from '../communications/communications.module';
import { CreditsModule } from '../communications/credits/credits.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentNotifyListener, INCIDENT_NOTIFY_QUEUE } from './incident-notify.listener';

/** [28.1.2] registered once in AppModule (D25); [28.2.x] incidents report/list/notify. */
@Module({
  imports: [
    TypeOrmModule.forFeature([StaffIncident, UserTenant, School]),
    AuditModule,
    PushModule,
    CommunicationsModule,
    CreditsModule,
    // attempts 1: handleIncidentCreated is not idempotent (push + SMS per holder); the job only
    // has to survive a restart.
    BullModule.registerQueue({
      name: INCIDENT_NOTIFY_QUEUE,
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 1000 },
    }),
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentNotifyListener],
  exports: [IncidentsService],
})
export class IncidentsModule {}
