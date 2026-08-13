import { Injectable } from '@nestjs/common';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';
import { TenantProviderConfigResolver } from '../../config/tenant-provider-config.resolver';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Meta WhatsApp Business Cloud API.
 *
 * Constraint: Meta only allows freeform `text` messages as a *reply*
 * within 24 hours of the recipient's last message to the business number.
 * Outside that window (true for essentially all proactive notifications
 * like fee reminders), Meta rejects freeform sends — a pre-approved
 * template is required instead. Callers should pass `templateName` for
 * proactive notifications; freeform `body` is only reliable for replies.
 * Templates themselves must be pre-created and approved in Meta Business
 * Manager — that's an external setup step, not something this code does.
 */
@Injectable()
export class WhatsAppCloudProvider implements CommunicationProvider {
  constructor(private readonly configResolver: TenantProviderConfigResolver) {}

  async send(params: CommunicationSendParams, tenantId: string): Promise<CommunicationSendResult> {
    try {
      // A ProviderNotConfiguredError from this call is caught by the same
      // catch block as a network failure below — this provider's contract
      // is "never throw" regardless of which step failed.
      const { phoneNumberId, accessToken, apiVersion } =
        await this.configResolver.resolveWhatsApp(tenantId);
      const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
      const to = normalizeBdPhoneNumber(params.to);

      const payload = params.templateName
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: {
              name: params.templateName,
              language: { code: params.templateLanguage ?? 'en' },
              components: params.templateParams?.length
                ? [
                    {
                      type: 'body',
                      parameters: params.templateParams.map((text) => ({ type: 'text', text })),
                    },
                  ]
                : undefined,
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: params.body },
          };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (response.ok && data?.messages?.length) {
        return { success: true, providerMessageId: data.messages[0].id, raw: data };
      }
      return {
        success: false,
        providerMessageId: null,
        error: data?.error?.message ?? 'Unknown Meta WhatsApp Cloud API error',
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
