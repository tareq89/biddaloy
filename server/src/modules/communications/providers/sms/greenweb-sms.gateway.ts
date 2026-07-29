import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunicationSendResult } from '../communication-provider.interface';
import { SmsGateway, isUnicodeMessage } from './sms-gateway.interface';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';

const DEFAULT_BASE_URL = 'https://api.greenweb.com.bd/api.php';

/**
 * Greenweb BD SMS gateway. GET-based REST API, keyed by an account token.
 * GREENWEB_API_URL is configurable in case the account's actual endpoint
 * differs from the documented default.
 */
@Injectable()
export class GreenwebSmsGateway implements SmsGateway {
  constructor(private readonly config: ConfigService) {}

  async sendSms(to: string, message: string): Promise<CommunicationSendResult> {
    try {
      const token = this.config.get<string>('GREENWEB_API_KEY');
      const baseUrl = this.config.get<string>('GREENWEB_API_URL') ?? DEFAULT_BASE_URL;
      const params = new URLSearchParams({
        token: token ?? '',
        to: normalizeBdPhoneNumber(to),
        message,
      });
      if (isUnicodeMessage(message)) {
        params.set('unicode', '1');
      }

      const response = await fetch(`${baseUrl}?${params.toString()}`, { method: 'GET' });
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
