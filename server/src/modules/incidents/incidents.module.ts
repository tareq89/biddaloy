import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffIncident } from './entities/staff-incident.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { PushModule } from '../push/push.module';
import { CommunicationsModule } from '../communications/communications.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentNotifyListener } from './incident-notify.listener';

/** [28.1.2] registered once in AppModule (D25); [28.2.x] incidents report/list/notify. */
@Module({
  imports: [
    TypeOrmModule.forFeature([StaffIncident, UserTenant, School]),
    PushModule,
    CommunicationsModule,
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentNotifyListener],
})
export class IncidentsModule {}
