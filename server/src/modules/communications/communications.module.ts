import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { StudentModule } from '../students/students.module';
import { FeeModule } from '../fees/fees.module';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { CommunicationsController } from './communications.controller';
import { CommunicationsProcessor } from './worker/communications.processor';
import { CommunicationProviderRegistryService } from './providers/communication-provider.registry';
import { SmsProviderFactory } from './providers/sms/sms-provider.factory';
import { GreenwebSmsGateway } from './providers/sms/greenweb-sms.gateway';
import { MimSmsGateway } from './providers/sms/mim-sms.gateway';
import { WhatsAppCloudProvider } from './providers/whatsapp/whatsapp-cloud.provider';
import { SmtpEmailProvider } from './providers/email/smtp-email.provider';
import { MessengerProvider } from './providers/messenger/messenger.provider';
import { COMMUNICATIONS_QUEUE } from './communications.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommunicationLog, ReminderBatch]),
    StudentModule,
    FeeModule,
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  providers: [
    CommunicationsService,
    BulkReminderService,
    CommunicationsProcessor,
    CommunicationProviderRegistryService,
    SmsProviderFactory,
    GreenwebSmsGateway,
    MimSmsGateway,
    WhatsAppCloudProvider,
    SmtpEmailProvider,
    MessengerProvider,
  ],
  controllers: [CommunicationsController],
  exports: [CommunicationsService, BulkReminderService],
})
export class CommunicationsModule {}
