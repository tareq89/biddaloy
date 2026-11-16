import { Injectable } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import { CommunicationProvider } from './communication-provider.interface';
import {
  MessagingConfigResolver,
  ResolveOptions,
  ResolvedMessaging,
} from '../config/messaging-config.resolver';
import { MailpitSinkProvider } from './sink/mailpit-sink.provider';
import { SendLimitService } from '../limits/send-limit.service';
import { isMessageSink } from './sink/message-sink';
import { messagingDescriptors } from '../../schools/settings/messaging-descriptors';
import { failedResult, segmentsFor, sendThroughProvider } from './send-through-provider';

/**
 * CommunicationMedium -> the provider the tenant chose for it. Resolution is per send, per tenant,
 * by `MessagingConfigResolver`; adding a vendor is one line in `MESSAGING_PROVIDERS`.
 */
@Injectable()
export class CommunicationProviderRegistryService {
  constructor(
    private readonly resolver: MessagingConfigResolver,
    private readonly limits: SendLimitService,
  ) {}

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
    // A medium is sendable iff some registered provider serves it (derived, not a second list).
    if (!messagingDescriptors().some((d) => d.medium === medium)) return undefined;
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
        // [60.0 D7, D16, D22] The daily cap counts sends on the platform account only; account
        // access and platform alerts (allowPlatformSms) and a school's own gateway are not counted.
        if (tenantId && resolved.source === 'platform' && params.allowPlatformSms !== true) {
          const counted = await this.limits.tryCount(tenantId, medium);
          if (counted !== 'OK') {
            return {
              success: false,
              providerMessageId: null,
              error: 'Daily limit reached.',
              segments: segmentsFor(medium, params),
              retryable: false,
              outcome: 'REJECTED',
            };
          }
        }
        return sendThroughProvider(resolved.provider, params, resolved.config, resolved.source);
      },
    };
  }
}
