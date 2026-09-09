import { Injectable } from '@nestjs/common';
import { countSmsSegments } from '@biddaloy/shared';
import { CommunicationSendResult } from '../communication-provider.interface';
import { SmsGateway } from './sms-gateway.interface';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';
import { ConnectionTestResult } from '../shared/connection-test.types';
import {
  assertSafeHttpDestination,
  DestinationBlockedError,
  OutboundDestinationError,
} from '../shared/outbound-destination-guard';
import { fetchPinnedJson } from '../shared/pinned-http';
import { ResolvedGreenwebSmsConfig } from '../../config/tenant-provider-config.resolver';

const DEFAULT_BASE_URL = 'https://api.greenweb.com.bd/api.php';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Greenweb BD SMS gateway. GET-based REST API, keyed by an account token.
 * `config` is resolved per tenant by `TenantProviderConfigResolver` and
 * passed in by `SmsProviderFactory` — this gateway no longer reads
 * `ConfigService` itself (#8.7.10).
 */
@Injectable()
export class GreenwebSmsGateway implements SmsGateway<ResolvedGreenwebSmsConfig> {
  async sendSms(
    to: string,
    message: string,
    config: ResolvedGreenwebSmsConfig,
  ): Promise<CommunicationSendResult> {
    const segmentInfo = countSmsSegments(message);
    try {
      const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
      const destination = await assertSafeHttpDestination(baseUrl);
      const params = new URLSearchParams({
        token: config.apiKey,
        to: normalizeBdPhoneNumber(to),
        message,
      });
      if (segmentInfo.encoding === 'UCS_2') {
        params.set('unicode', '1');
      }

      const data = (await fetchPinnedJson(destination, `${baseUrl}?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })) as Record<string, any>;

      if (data?.status === 'success') {
        return {
          success: true,
          providerMessageId: data.msgid ?? null,
          raw: data,
          segments: segmentInfo.segments,
          outcome: 'ACCEPTED',
        };
      }
      // Greenweb answered — it just refused the message (bad token,
      // invalid number, etc.). A definite REJECTED, same as `retryable`
      // would say if this branch set it.
      return {
        success: false,
        providerMessageId: null,
        error: data?.error_msg ?? 'Unknown Greenweb error',
        raw: data,
        segments: segmentInfo.segments,
        retryable: false,
        outcome: 'REJECTED',
      };
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
        segments: segmentInfo.segments,
        // Only a resolved-to-a-blocked-destination is permanent; a DNS
        // hiccup or network blip may succeed on retry — and might have
        // reached Greenweb anyway, so it's AMBIGUOUS, not REJECTED.
        retryable: err instanceof DestinationBlockedError ? false : undefined,
        outcome: err instanceof DestinationBlockedError ? 'REJECTED' : 'AMBIGUOUS',
      };
    }
  }

  /**
   * #8.7.12's connection test — a balance check, Greenweb's cheapest
   * token-verification call, instead of sending a real SMS.
   */
  async testConnection(config: ResolvedGreenwebSmsConfig): Promise<ConnectionTestResult> {
    try {
      const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
      const destination = await assertSafeHttpDestination(baseUrl);
      const params = new URLSearchParams({ token: config.apiKey, type: 'balance' });

      const data = (await fetchPinnedJson(destination, `${baseUrl}?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })) as Record<string, any>;

      if (data?.status === 'success') {
        return { success: true, message: 'Connected — Greenweb account token verified.' };
      }
      return {
        success: false,
        message: 'Authentication rejected — check the account token.',
      };
    } catch (err) {
      if (err instanceof OutboundDestinationError) {
        return { success: false, message: err.message };
      }
      return { success: false, message: 'Could not reach the Greenweb API.' };
    }
  }
}
