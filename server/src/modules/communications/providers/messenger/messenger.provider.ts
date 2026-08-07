import { Injectable } from '@nestjs/common';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { TenantProviderConfigResolver } from '../../config/tenant-provider-config.resolver';

/**
 * Placeholder for future Messenger support.
 *
 * Meta's Messenger Platform can only deliver to a PSID (Page-Scoped ID) of
 * a user who has already messaged the school's Facebook Page (or opted in
 * via a Messenger entry point) — there is no API to resolve a guardian's
 * phone number or email into a Messenger recipient. A real implementation
 * needs a PSID-capture flow elsewhere in the product before this provider
 * can do anything with `recipient_address`, so it stays a stub.
 *
 * Still resolves the tenant's config first so an unconfigured tenant gets
 * "configure Messenger in settings" rather than "not yet implemented" —
 * distinguishing the two matters for the connection-test flow in #8.7.12.
 *
 * Returns a failure result rather than throwing, per the
 * CommunicationProvider contract — a thrown error here would leave the
 * CommunicationLog row stuck QUEUED instead of being recorded FAILED.
 */
@Injectable()
export class MessengerProvider implements CommunicationProvider {
  constructor(private readonly configResolver: TenantProviderConfigResolver) {}

  async send(_params: CommunicationSendParams, tenantId: string): Promise<CommunicationSendResult> {
    try {
      await this.configResolver.resolveMessenger(tenantId);
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return {
      success: false,
      providerMessageId: null,
      error: 'Messenger sending is not yet implemented',
    };
  }
}
