import { Injectable } from '@nestjs/common';
import { CommunicationMedium } from '@beton-boi/shared';
import {
  ConnectionTestResult,
  TestableCommunicationMedium,
} from '../providers/shared/connection-test.types';
import { WhatsAppCloudProvider } from '../providers/whatsapp/whatsapp-cloud.provider';
import { SmtpEmailProvider } from '../providers/email/smtp-email.provider';
import { SmsProviderFactory } from '../providers/sms/sms-provider.factory';
import { MessengerProvider } from '../providers/messenger/messenger.provider';
import {
  EmailOverride,
  MessengerOverride,
  SmsOverride,
  TenantProviderConfigResolver,
  WhatsAppOverride,
} from '../config/tenant-provider-config.resolver';

/**
 * #8.7.12: verifies a medium's credentials against the real provider
 * without sending an actual message to a real recipient — each provider's
 * own `testConnection()` picks that provider's cheapest verification call
 * (a metadata fetch, `SMTP VRFY`-equivalent, a balance check — see each
 * provider file's own comment).
 *
 * `override` is the unsaved form values the dashboard is currently
 * editing; omitted fields fall through to the tenant's already-stored
 * config, then to the env-var platform fallback — the exact same
 * override → tenant → env chain `TenantProviderConfigResolver` already
 * implements for real sends, reused here rather than duplicated.
 *
 * Never lets a raw provider error payload (which could echo the
 * credential being tested) escape to the caller — every path returns
 * `ConnectionTestResult`'s already-sanitized `message`, whether the
 * failure came from the provider's own HTTP call or from
 * `TenantProviderConfigResolver` throwing `ProviderNotConfiguredError`
 * before a call was ever made.
 */
@Injectable()
export class ConnectionTestService {
  constructor(
    private readonly configResolver: TenantProviderConfigResolver,
    private readonly whatsapp: WhatsAppCloudProvider,
    private readonly email: SmtpEmailProvider,
    private readonly sms: SmsProviderFactory,
    private readonly messenger: MessengerProvider,
  ) {}

  async test(
    tenantId: string,
    medium: TestableCommunicationMedium,
    override?: Record<string, unknown>,
  ): Promise<ConnectionTestResult> {
    try {
      switch (medium) {
        case CommunicationMedium.WHATSAPP: {
          const config = await this.configResolver.resolveWhatsApp(
            tenantId,
            override as WhatsAppOverride,
          );
          return await this.whatsapp.testConnection(config);
        }
        case CommunicationMedium.EMAIL: {
          const config = await this.configResolver.resolveEmail(
            tenantId,
            override as EmailOverride,
          );
          return await this.email.testConnection(config);
        }
        case CommunicationMedium.MESSENGER: {
          const config = await this.configResolver.resolveMessenger(
            tenantId,
            override as MessengerOverride,
          );
          return await this.messenger.testConnection(config);
        }
        case CommunicationMedium.SMS:
          return await this.sms.testConnection(tenantId, override as SmsOverride);
      }
    } catch (err) {
      // ProviderNotConfiguredError's own message is already an actionable,
      // secret-free string (see provider-not-configured.error.ts) — safe
      // to surface as-is, same as every provider's own testConnection().
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed.',
      };
    }
  }
}
