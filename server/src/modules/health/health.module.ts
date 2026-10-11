import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../communications/communications.constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  // Registering the queue here (rather than importing CommunicationsModule)
  // keeps this module's dependency surface to exactly what readiness
  // probes. Each registration is its own Queue instance; pass the shared
  // options so a job added here behaves like every other producer's.
  imports: [
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
