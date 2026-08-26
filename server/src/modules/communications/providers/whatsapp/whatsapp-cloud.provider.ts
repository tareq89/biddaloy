import { Injectable } from '@nestjs/common';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';
import { ConnectionTestResult } from '../shared/connection-test.types';
import { isValidGraphApiId, isValidGraphApiVersion } from '../shared/graph-api-path-segment.util';
import { mapMetaGraphError } from '../shared/meta-graph-error.util';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';
import { DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE } from '../../whatsapp-template.util';
import {
  ResolvedWhatsAppConfig,
  TenantProviderConfigResolver,
} from '../../config/tenant-provider-config.resolver';

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
              // Shared with the reminder preview path so the review step
              // shows the language Meta will really receive.
              language: { code: params.templateLanguage ?? DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE },
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
        retryable: err instanceof ProviderNotConfiguredError ? false : undefined,
      };
    }
  }

  /**
   * #8.7.12's connection test — reads the phone number's own metadata
   * (`GET /{phoneNumberId}`) instead of sending a message, the cheapest
   * call that still proves both the phone number id and the access token
   * are valid together. `config` can be an unsaved, in-flight draft (the
   * dashboard verifying before saving) or the tenant's stored config —
   * this method doesn't care which, only `ConnectionTestService` does.
   */
  async testConnection(config: ResolvedWhatsAppConfig): Promise<ConnectionTestResult> {
    if (!isValidGraphApiId(config.phoneNumberId)) {
      return { success: false, message: 'Phone number ID is not a valid WhatsApp identifier.' };
    }
    if (!isValidGraphApiVersion(config.apiVersion)) {
      return { success: false, message: 'API version is not a valid Graph API version.' };
    }
    try {
      const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}?fields=id`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();

      if (response.ok && data?.id) {
        return { success: true, message: 'Connected — phone number ID verified.' };
      }
      return { success: false, message: mapMetaGraphError(data) };
    } catch {
      return { success: false, message: 'Could not reach the WhatsApp Cloud API.' };
    }
  }
}
