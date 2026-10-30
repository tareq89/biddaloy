import { Injectable } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import { CommunicationProvider } from './communication-provider.interface';
import {
  MessagingConfigResolver,
  ResolveOptions,
  ResolvedMessaging,
} from '../config/messaging-config.resolver';
import { MailpitSinkProvider } from './sink/mailpit-sink.provider';
import { isMessageSink } from './sink/message-sink';
import { failedResult, sendThroughProvider } from './send-through-provider';

const MEDIA = [
  CommunicationMedium.SMS,
  CommunicationMedium.WHATSAPP,
  CommunicationMedium.EMAIL,
  CommunicationMedium.MESSENGER,
];

/**
 * CommunicationMedium -> the provider the tenant chose for it. Resolution is per send, per tenant,
 * by `MessagingConfigResolver`; adding a vendor is one line in `MESSAGING_PROVIDERS`.
 */
@Injectable()
export class CommunicationProviderRegistryService {
  constructor(private readonly resolver: MessagingConfigResolver) {}

  /** The tenant's chosen provider and its resolved config (connection test, readiness). */
  resolveFor(
    medium: CommunicationMedium,
    tenantId: string | null,
    opts?: ResolveOptions,
  ): Promise<ResolvedMessaging> {
    return this.resolver.resolve(medium, tenantId, opts);
  }

  /** `send(params, tenantId)` resolves the tenant's provider, then sends. Never throws. */
  resolve(medium: CommunicationMedium): CommunicationProvider | undefined {
    if (!MEDIA.includes(medium)) return undefined;
    // Epic 87 (D9): MESSAGE_SINK=mailpit sends every medium to the test inbox, before any config is read.
    if (isMessageSink()) return MailpitSinkProvider.forMedium(medium);
    return {
      send: async (params, tenantId) => {
        let resolved: ResolvedMessaging;
        try {
          resolved = await this.resolver.resolve(medium, tenantId, {
            allowPlatformKeys: params.allowPlatformSms === true,
          });
        } catch (err) {
          return failedResult(err, medium, params);
        }
        return sendThroughProvider(resolved.provider, params, resolved.config);
      },
    };
  }
}
