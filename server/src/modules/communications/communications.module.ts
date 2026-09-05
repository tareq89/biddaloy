import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { StudentModule } from '../students/students.module';
import { FeeModule } from '../fees/fees.module';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SingleReminderService } from './single-reminder.service';
import { CommunicationsController } from './communications.controller';
import { CommunicationsProcessor } from './worker/communications.processor';
import { CommunicationProviderRegistryService } from './providers/communication-provider.registry';
import { SmsProviderFactory } from './providers/sms/sms-provider.factory';
import { GreenwebSmsGateway } from './providers/sms/greenweb-sms.gateway';
import { MimSmsGateway } from './providers/sms/mim-sms.gateway';
import { WhatsAppCloudProvider } from './providers/whatsapp/whatsapp-cloud.provider';
import { SmtpEmailProvider } from './providers/email/smtp-email.provider';
import { MessengerProvider } from './providers/messenger/messenger.provider';
import { TenantProviderConfigResolver } from './config/tenant-provider-config.resolver';
import { ConnectionTestService } from './testing/connection-test.service';
import { ProviderConnectionTestController } from './testing/provider-connection-test.controller';
import { COMMUNICATIONS_QUEUE } from './communications.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommunicationLog, ReminderBatch]),
    StudentModule,
    FeeModule,
    AuditModule,
    SchoolsModule,
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
    SingleReminderService,
    CommunicationsProcessor,
    CommunicationProviderRegistryService,
    TenantProviderConfigResolver,
    SmsProviderFactory,
    GreenwebSmsGateway,
    MimSmsGateway,
    WhatsAppCloudProvider,
    SmtpEmailProvider,
    MessengerProvider,
    ConnectionTestService,
  ],
  controllers: [CommunicationsController, ProviderConnectionTestController],
  exports: [
    CommunicationsService,
    BulkReminderService,
    SingleReminderService,
    CommunicationProviderRegistryService,
  ],
})
export class CommunicationsModule {}
