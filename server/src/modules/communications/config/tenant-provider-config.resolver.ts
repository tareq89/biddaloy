import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmsGatewayName } from '@biddaloy/shared';
import { SchoolsService } from '../../schools/schools.service';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { ProviderNotConfiguredError } from './provider-not-configured.error';

export interface ResolvedWhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}

export interface ResolvedEmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export interface ResolvedMessengerConfig {
  pageId: string;
  accessToken: string;
}

export interface ResolvedGreenwebSmsConfig {
  gateway: 'greenweb';
  apiKey: string;
  apiUrl?: string;
}

export interface ResolvedMimSmsConfig {
  gateway: 'mimsms';
  apiKey: string;
  senderId: string;
  apiUrl?: string;
}

export type ResolvedSmsConfig = ResolvedGreenwebSmsConfig | ResolvedMimSmsConfig;

export type WhatsAppOverride = Partial<{
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}>;

export type EmailOverride = Partial<{
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}>;

export type MessengerOverride = Partial<{ pageId: string; accessToken: string }>;

export type SmsOverride = Partial<{
  provider: SmsGatewayName;
  greenweb: Partial<{ apiKey: string; apiUrl: string }>;
  mimsms: Partial<{ apiKey: string; senderId: string; apiUrl: string }>;
}>;

const DEFAULT_WHATSAPP_API_VERSION = 'v21.0';
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMS_GATEWAY: SmsGatewayName = 'greenweb';

/**
 * The one place that implements "tenant setting → env var → unconfigured"
 * for every communications medium — #8.7.10's whole point. Before this,
 * each of the 4 providers read process-wide env directly, which meant
 * every tenant shared one gateway account; after, each provider calls one
 * of the methods below with its own tenant id, and this resolver is the
 * only thing that knows the fallback order.
 *
 * Reads through `TenantSettingsCache` (shared with `SchoolsService` via
 * `SchoolsModule`'s export — not a second, unrelated cache instance), so
 * a burst of sends for the same tenant costs one decrypt, not one per
 * message.
 *
 * Every `resolve*` method takes an optional `override` — plaintext field
 * values that win over both the stored tenant setting and the env
 * fallback (#8.7.12). This is what lets the dashboard's "Test connection"
 * action verify credentials *before* saving them: the caller passes the
 * unsaved form values as `override`, any field the form left blank falls
 * through to whatever's already stored for that tenant (the same "omit
 * to leave unchanged" contract `TenantSettingsDto` PATCHes already use),
 * so testing after only touching one field doesn't require re-typing
 * every other one.
 *
 * Every `resolve*` method throws `ProviderNotConfiguredError` when a
 * required field can't be resolved from any source — callers (each
 * provider's own `send()`/`testConnection()`) catch it and convert to a
 * `{ success: false }` result, never let it propagate as an unhandled
 * rejection.
 */
@Injectable()
export class TenantProviderConfigResolver {
  constructor(
    private readonly schools: SchoolsService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly config: ConfigService,
  ) {}

  private loadSettings(tenantId: string) {
    return this.settingsCache.getOrLoad(tenantId, () =>
      this.schools.getDecryptedSettings(tenantId),
    );
  }

  async resolveWhatsApp(
    tenantId: string,
    override?: WhatsAppOverride,
  ): Promise<ResolvedWhatsAppConfig> {
    const settings = await this.loadSettings(tenantId);
    const tenant = settings.communications?.whatsapp;

    const phoneNumberId =
      override?.phoneNumberId ??
      tenant?.phoneNumberId ??
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken =
      override?.accessToken ??
      tenant?.accessToken ??
      this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const apiVersion =
      override?.apiVersion ??
      tenant?.apiVersion ??
      this.config.get<string>('WHATSAPP_API_VERSION') ??
      DEFAULT_WHATSAPP_API_VERSION;

    if (!phoneNumberId || !accessToken) {
      throw new ProviderNotConfiguredError(
        'WhatsApp',
        "Configure it on this school's settings, or set WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN as a platform-wide fallback.",
      );
    }

    return { phoneNumberId, accessToken, apiVersion };
  }

  async resolveEmail(tenantId: string, override?: EmailOverride): Promise<ResolvedEmailConfig> {
    const settings = await this.loadSettings(tenantId);
    const tenant = settings.communications?.email;

    const host = override?.host ?? tenant?.host ?? this.config.get<string>('SMTP_HOST');
    const port =
      override?.port ??
      tenant?.port ??
      Number(this.config.get<string>('SMTP_PORT') ?? DEFAULT_SMTP_PORT);
    const user = override?.user ?? tenant?.user ?? this.config.get<string>('SMTP_USER');
    const password =
      override?.password ?? tenant?.password ?? this.config.get<string>('SMTP_PASSWORD');
    const from = override?.from ?? tenant?.from ?? this.config.get<string>('SMTP_FROM');

    if (!host || !user || !password || !from) {
      throw new ProviderNotConfiguredError(
        'Email',
        "Configure it on this school's settings, or set SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM as a platform-wide fallback.",
      );
    }

    return { host, port, user, password, from };
  }

  async resolveMessenger(
    tenantId: string,
    override?: MessengerOverride,
  ): Promise<ResolvedMessengerConfig> {
    const settings = await this.loadSettings(tenantId);
    const tenant = settings.communications?.messenger;

    const pageId = override?.pageId ?? tenant?.pageId;
    const accessToken = override?.accessToken ?? tenant?.accessToken;

    // No env-var fallback exists for Messenger — there's no platform-wide
    // Messenger account today (see MessengerProvider's own comment on why
    // it's still a stub regardless of config).
    if (!pageId || !accessToken) {
      throw new ProviderNotConfiguredError(
        'Messenger',
        "Configure it on this school's settings — there is no platform-wide fallback for Messenger.",
      );
    }

    return { pageId, accessToken };
  }

  async resolveSms(tenantId: string, override?: SmsOverride): Promise<ResolvedSmsConfig> {
    const settings = await this.loadSettings(tenantId);
    const tenant = settings.communications?.sms;

    const gateway: SmsGatewayName =
      override?.provider ??
      tenant?.provider ??
      (this.config.get<string>('SMS_PROVIDER') as SmsGatewayName | undefined) ??
      DEFAULT_SMS_GATEWAY;

    if (gateway === 'mimsms') {
      const apiKey =
        override?.mimsms?.apiKey ??
        tenant?.mimsms?.apiKey ??
        this.config.get<string>('MIMSMS_API_KEY');
      const senderId =
        override?.mimsms?.senderId ??
        tenant?.mimsms?.senderId ??
        this.config.get<string>('MIMSMS_SENDER_ID');
      const apiUrl =
        override?.mimsms?.apiUrl ??
        tenant?.mimsms?.apiUrl ??
        this.config.get<string>('MIMSMS_API_URL');

      if (!apiKey || !senderId) {
        throw new ProviderNotConfiguredError(
          'SMS (MimSMS)',
          "Configure it on this school's settings, or set MIMSMS_API_KEY/MIMSMS_SENDER_ID as a platform-wide fallback.",
        );
      }
      return { gateway: 'mimsms', apiKey, senderId, ...(apiUrl ? { apiUrl } : {}) };
    }

    const apiKey =
      override?.greenweb?.apiKey ??
      tenant?.greenweb?.apiKey ??
      this.config.get<string>('GREENWEB_API_KEY');
    const apiUrl =
      override?.greenweb?.apiUrl ??
      tenant?.greenweb?.apiUrl ??
      this.config.get<string>('GREENWEB_API_URL');

    if (!apiKey) {
      throw new ProviderNotConfiguredError(
        'SMS (Greenweb)',
        "Configure it on this school's settings, or set GREENWEB_API_KEY as a platform-wide fallback.",
      );
    }
    return { gateway: 'greenweb', apiKey, ...(apiUrl ? { apiUrl } : {}) };
  }
}
