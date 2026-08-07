import { Injectable } from '@nestjs/common';
import { CommunicationSendResult } from '../communication-provider.interface';
import { SmsGateway, isUnicodeMessage } from './sms-gateway.interface';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';
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
    try {
      const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
      const params = new URLSearchParams({
        token: config.apiKey,
        to: normalizeBdPhoneNumber(to),
        message,
      });
      if (isUnicodeMessage(message)) {
        params.set('unicode', '1');
      }

      const response = await fetch(`${baseUrl}?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();

      if (data?.status === 'success') {
        return { success: true, providerMessageId: data.msgid ?? null, raw: data };
      }
      return {
        success: false,
        providerMessageId: null,
        error: data?.error_msg ?? 'Unknown Greenweb error',
        raw: data,
      };
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
