import { Injectable } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import {
  ConnectionTestResult,
  TestableCommunicationMedium,
} from '../providers/shared/connection-test.types';
import { isMessageSink } from '../providers/sink/message-sink';
import { MetaCloudProvider } from '../providers/whatsapp/meta-cloud.provider';
import { SmtpProvider } from '../providers/email/smtp.provider';
import { SmsProviderFactory } from '../providers/sms/sms-provider.factory';
import { MetaPageProvider } from '../providers/messenger/meta-page.provider';
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
    private readonly whatsapp: MetaCloudProvider,
    private readonly email: SmtpProvider,
    private readonly sms: SmsProviderFactory,
    private readonly messenger: MetaPageProvider,
  ) {}

  async test(
    tenantId: string,
    medium: TestableCommunicationMedium,
    override?: Record<string, unknown>,
  ): Promise<ConnectionTestResult> {
    // Epic 87 (D24): on a sink stack nothing real is configured; fixed text, no tenant data read.
    if (isMessageSink()) {
      return { success: true, message: 'Test site: messages go to the test inbox' };
    }
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
