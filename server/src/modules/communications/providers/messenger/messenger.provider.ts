import { Injectable } from '@nestjs/common';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { ConnectionTestResult } from '../shared/connection-test.types';
import { mapMetaGraphError } from '../shared/meta-graph-error.util';
import {
  ResolvedMessengerConfig,
  TenantProviderConfigResolver,
} from '../../config/tenant-provider-config.resolver';

const REQUEST_TIMEOUT_MS = 10_000;

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

  /**
   * #8.7.12's connection test. Sending itself is still a stub (see class
   * comment), but the credential *can* be verified independently — Page
   * access tokens work against the Graph API today, so fetching the
   * page's own metadata (`GET /{pageId}`) is a real, cheap check that the
   * token is valid and scoped to this page, well ahead of the day
   * `send()` stops being a stub.
   */
  async testConnection(config: ResolvedMessengerConfig): Promise<ConnectionTestResult> {
    try {
      const url = `https://graph.facebook.com/${config.pageId}?fields=id`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();

      if (response.ok && data?.id) {
        return { success: true, message: 'Connected — Facebook Page verified.' };
      }
      return { success: false, message: mapMetaGraphError(data) };
    } catch {
      return { success: false, message: 'Could not reach the Facebook Graph API.' };
    }
  }
}
