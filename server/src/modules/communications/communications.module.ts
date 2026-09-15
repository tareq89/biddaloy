import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { StudentModule } from '../students/students.module';
import { FeeModule } from '../fees/fees.module';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { PushModule } from '../push/push.module';
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
import { CreditsModule } from './credits/credits.module';
import { FeeNotificationsListener } from './fee-notifications.listener';
import { InvoiceNotificationsListener } from './invoice-notifications.listener';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommunicationLog, ReminderBatch, Guardian]),
    StudentModule,
    FeeModule,
    AuditModule,
    // #555: the automated dispatcher (CommunicationsProcessor) needs a
    // guardian's linked user id to try push before falling back to the
    // preferred channel. No cycle risk — PushModule only depends on
    // TypeOrmModule, unlike AccountAccessModule (see the forwardRef note
    // below).
    PushModule,
    // #529 (SchoolsModule) added a forwardRef import of AccountAccessModule,
    // which itself eagerly imports this module — Schools -> AccountAccess ->
    // Communications -> Schools. forwardRef here breaks the third edge of
    // that triangle; without it, `SchoolsModule` resolves to `undefined` at
    // require-time depending on which module Nest happens to load first.
    forwardRef(() => SchoolsModule),
    // [16.5.4] `InvoiceNotificationsListener` needs `InvoiceShareService` to
    // mint the receipt link, and `InvoicesController`'s new
    // `POST /invoices/:id/send` needs `CommunicationsService` — the two
    // modules depend on each other, so both sides use `forwardRef` (same
    // shape as the `SchoolsModule` edge above).
    forwardRef(() => InvoicesModule),
    CreditsModule,
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
    FeeNotificationsListener,
    InvoiceNotificationsListener,
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
