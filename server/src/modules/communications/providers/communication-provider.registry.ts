import { Injectable } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import {
  CommunicationProvider,
  CommunicationProviderRegistry,
} from './communication-provider.interface';
import { SmsProviderFactory } from './sms/sms-provider.factory';
import { WhatsAppCloudProvider } from './whatsapp/whatsapp-cloud.provider';
import { SmtpEmailProvider } from './email/smtp-email.provider';
import { MessengerProvider } from './messenger/messenger.provider';
import { MailpitSinkProvider } from './sink/mailpit-sink.provider';
import { isMessageSink } from './sink/message-sink';

/**
 * Maps CommunicationMedium -> the provider that handles it. This is the
 * only place CommunicationsProcessor needs to route through, so adding a
 * new channel later means registering it here, not touching the processor.
 */
@Injectable()
export class CommunicationProviderRegistryService {
  private readonly registry: CommunicationProviderRegistry;

  constructor(
    smsProviderFactory: SmsProviderFactory,
    whatsAppCloudProvider: WhatsAppCloudProvider,
    smtpEmailProvider: SmtpEmailProvider,
    messengerProvider: MessengerProvider,
  ) {
    // Epic 87: with MESSAGE_SINK=mailpit every medium goes to the Mailpit test inbox. Checked
    // here, before any tenant/env provider config is read, so the resolver can never throw "unconfigured".
    if (isMessageSink()) {
      this.registry = Object.fromEntries(
        [
          CommunicationMedium.SMS,
          CommunicationMedium.WHATSAPP,
          CommunicationMedium.EMAIL,
          CommunicationMedium.MESSENGER,
        ].map((medium) => [medium, MailpitSinkProvider.forMedium(medium)]),
      );
      return;
    }
    this.registry = {
      [CommunicationMedium.SMS]: smsProviderFactory,
      [CommunicationMedium.WHATSAPP]: whatsAppCloudProvider,
      [CommunicationMedium.EMAIL]: smtpEmailProvider,
      [CommunicationMedium.MESSENGER]: messengerProvider,
    };
  }

  resolve(medium: CommunicationMedium): CommunicationProvider | undefined {
    return this.registry[medium];
  }
}
