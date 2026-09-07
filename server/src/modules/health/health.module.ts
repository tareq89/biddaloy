import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  // Registering the queue here (rather than importing CommunicationsModule)
  // keeps this module's dependency surface to exactly what readiness
  // probes — BullMQ registration is idempotent per queue name, so this and
  // CommunicationsModule's own registerQueue() share the same underlying
  // queue instance rather than conflicting.
  imports: [BullModule.registerQueue({ name: COMMUNICATIONS_QUEUE })],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
