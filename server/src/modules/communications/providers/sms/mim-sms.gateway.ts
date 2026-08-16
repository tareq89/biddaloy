import { Injectable } from '@nestjs/common';
import { CommunicationSendResult } from '../communication-provider.interface';
import { SmsGateway, isUnicodeMessage } from './sms-gateway.interface';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';
import { ConnectionTestResult } from '../shared/connection-test.types';
import {
  assertSafeHttpDestination,
  DestinationBlockedError,
} from '../shared/outbound-destination-guard';
import { fetchPinnedJson } from '../shared/pinned-http';
import { ResolvedMimSmsConfig } from '../../config/tenant-provider-config.resolver';

const DEFAULT_BASE_URL = 'https://api.mimsms.com/api/SmsSending/SMS';
// MimSMS's balance-check endpoint, a different path under the same host —
// `config.apiUrl` only ever overrides the send endpoint, so it doesn't
// apply here.
const BALANCE_URL = 'https://api.mimsms.com/api/User/Balance';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * MimSMS BD gateway. POST-JSON REST API, keyed by api_key + senderid.
 * `config` is resolved per tenant by `TenantProviderConfigResolver` and
 * passed in by `SmsProviderFactory` — this gateway no longer reads
 * `ConfigService` itself (#8.7.10).
 */
@Injectable()
export class MimSmsGateway implements SmsGateway<ResolvedMimSmsConfig> {
  async sendSms(
    to: string,
    message: string,
    config: ResolvedMimSmsConfig,
  ): Promise<CommunicationSendResult> {
    try {
      const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
      const destination = await assertSafeHttpDestination(baseUrl);

      const data = (await fetchPinnedJson(destination, baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          api_key: config.apiKey,
          senderid: config.senderId,
          number: normalizeBdPhoneNumber(to),
          message,
          type: isUnicodeMessage(message) ? 'unicode' : 'text',
        }),
      })) as Record<string, any>;

      if (data?.status === 'success') {
        return { success: true, providerMessageId: data.transaction_id ?? null, raw: data };
      }
      return {
        success: false,
        providerMessageId: null,
        error: data?.message ?? 'Unknown MimSMS error',
        raw: data,
      };
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
        // Only a resolved-to-a-blocked-destination is permanent; a DNS
        // hiccup or network blip may succeed on retry.
        retryable: err instanceof DestinationBlockedError ? false : undefined,
      };
    }
  }

  /**
   * #8.7.12's connection test — a balance check, MimSMS's cheapest
   * token-verification call, instead of sending a real SMS.
   */
  async testConnection(config: ResolvedMimSmsConfig): Promise<ConnectionTestResult> {
    try {
      const params = new URLSearchParams({ api_key: config.apiKey });
      // BALANCE_URL is a hardcoded constant, not tenant-controlled, so
      // there's nothing to pin — routing it through the guard/dispatcher
      // would just add a pointless extra DNS round-trip. `redirect: 'error'`
      // still applies directly since plain `fetch` doesn't get it for free.
      const response = await fetch(`${BALANCE_URL}?${params.toString()}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();

      if (data?.status === 'success') {
        return { success: true, message: 'Connected — MimSMS account credentials verified.' };
      }
      return {
        success: false,
        message: 'Authentication rejected — check the API key.',
      };
    } catch {
      return { success: false, message: 'Could not reach the MimSMS API.' };
    }
  }
}
