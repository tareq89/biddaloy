import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../communications/communications.constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PlatformAlert } from './platform-alerts/platform-alert.entity';
import { PlatformAlertsController } from './platform-alerts/platform-alerts.controller';
import { PlatformAlertsService } from './platform-alerts/platform-alerts.service';
import { GreenwebProvider } from '../communications/providers/sms/greenweb.provider';
import { MimsmsProvider } from '../communications/providers/sms/mimsms.provider';

@Module({
  // Registering the queue here (rather than importing CommunicationsModule)
  // keeps this module's dependency surface to exactly what readiness
  // probes. Each registration is its own Queue instance; pass the shared
  // options so a job added here behaves like every other producer's.
  imports: [
    TypeOrmModule.forFeature([PlatformAlert]),
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
  ],
  controllers: [HealthController, PlatformAlertsController],
  // Both gateways are dependency-free; importing CommunicationsModule would pull BullMQ into
  // the alert path, which must keep working while Redis is down.
  providers: [HealthService, PlatformAlertsService, GreenwebProvider, MimsmsProvider],
})
export class HealthModule {}
