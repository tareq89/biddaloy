import { Injectable } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import {
  CommunicationProvider,
  CommunicationProviderRegistry,
} from './communication-provider.interface';
import { SmsProviderFactory } from './sms/sms-provider.factory';
import { MetaCloudProvider } from './whatsapp/meta-cloud.provider';
import { SmtpProvider } from './email/smtp.provider';
import { MetaPageProvider } from './messenger/meta-page.provider';
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
    whatsAppCloudProvider: MetaCloudProvider,
    smtpEmailProvider: SmtpProvider,
    messengerProvider: MetaPageProvider,
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
      [CommunicationMedium.WHATSAPP]: {
        send: (p, t) => whatsAppCloudProvider.sendForTenant(p, t as string),
      },
      [CommunicationMedium.EMAIL]: { send: (p, t) => smtpEmailProvider.sendForTenant(p, t) },
      [CommunicationMedium.MESSENGER]: {
        send: (p, t) => messengerProvider.sendForTenant(p, t as string),
      },
    };
  }

  resolve(medium: CommunicationMedium): CommunicationProvider | undefined {
    return this.registry[medium];
  }
}
