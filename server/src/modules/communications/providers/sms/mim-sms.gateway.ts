import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunicationSendResult } from '../communication-provider.interface';
import { SmsGateway, isUnicodeMessage } from './sms-gateway.interface';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';

const DEFAULT_BASE_URL = 'https://api.mimsms.com/api/SmsSending/SMS';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * MimSMS BD gateway. POST-JSON REST API, keyed by api_key + senderid.
 * MIMSMS_API_URL is configurable in case the account's actual endpoint
 * differs from the documented default.
 */
@Injectable()
export class MimSmsGateway implements SmsGateway {
  constructor(private readonly config: ConfigService) {}

  async sendSms(to: string, message: string): Promise<CommunicationSendResult> {
    try {
      const apiKey = this.config.get<string>('MIMSMS_API_KEY');
      const senderId = this.config.get<string>('MIMSMS_SENDER_ID');
      const baseUrl = this.config.get<string>('MIMSMS_API_URL') ?? DEFAULT_BASE_URL;

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          api_key: apiKey,
          senderid: senderId,
          number: normalizeBdPhoneNumber(to),
          message,
          type: isUnicodeMessage(message) ? 'unicode' : 'text',
        }),
      });
      const data = await response.json();

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
      };
    }
  }
}
