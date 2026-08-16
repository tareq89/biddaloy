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
 * through to whatever's already stored for that tenant, the same "omit
 * to leave unchanged" contract `TenantSettingsDto` PATCHes already use —
 * so testing after only touching one field doesn't require re-typing
 * every other one, *as long as the destination didn't change*.
 *
 * Fields do NOT fall back independently across trust tiers, though — a
 * medium's config source is decided as a unit, most to least trusted
 * (env/default → tenant → override):
 *   - If `override` sets the field that determines the destination
 *     (SMTP `host`/`port`, the active SMS gateway's `apiUrl`), the whole
 *     medium must be self-contained in `override` — it can never borrow
 *     the tenant's or platform's real credentials for a caller-chosen
 *     target. Without this, `POST /schools/:id/settings/test` would let
 *     an admin exfiltrate stored secrets to an arbitrary host by
 *     "testing" a new destination without supplying new credentials.
 *   - Else if the tenant has touched this medium at all (any field set,
 *     including an explicit `null` clear), the whole medium must resolve
 *     from `tenant`/`override` — it never falls back to the platform env
 *     var. Without this, a tenant that clears one credential (the
 *     documented way to stop using their own account) would silently
 *     keep sending under the platform's account instead of failing
 *     closed.
 *   - Otherwise (medium untouched by both), the full env/default
 *     fallback applies as before — there's no confused-deputy risk when
 *     the destination is ops-controlled.
 * WhatsApp/Messenger have no tenant- or override-influenceable
 * destination (the Graph API host is hardcoded), so only the second rule
 * applies to them.
 *
 * Every `resolve*` method throws `ProviderNotConfiguredError` when a
 * required field can't be resolved under the rules above — callers (each
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

    // A tenant that has touched this medium at all owns it outright —
    // mixing in platform credentials would send under an account the
    // tenant never chose (and, for a deliberately cleared secret,
    // explicitly rejected).
    const tenantOwnsIt = tenant?.phoneNumberId !== undefined || tenant?.accessToken !== undefined;

    const phoneNumberId = tenantOwnsIt
      ? (override?.phoneNumberId ?? tenant?.phoneNumberId)
      : (override?.phoneNumberId ?? this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID'));
    const accessToken = tenantOwnsIt
      ? (override?.accessToken ?? tenant?.accessToken)
      : (override?.accessToken ?? this.config.get<string>('WHATSAPP_ACCESS_TOKEN'));
    const apiVersion =
      override?.apiVersion ??
      tenant?.apiVersion ??
      this.config.get<string>('WHATSAPP_API_VERSION') ??
      DEFAULT_WHATSAPP_API_VERSION;

    if (!phoneNumberId || !accessToken) {
      throw new ProviderNotConfiguredError(
        'WhatsApp',
        tenantOwnsIt
          ? "Complete WhatsApp's phone number ID and access token together on this school's settings — a partially-configured medium never falls back to the platform account."
          : "Configure it on this school's settings, or set WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN as a platform-wide fallback.",
      );
    }

    return { phoneNumberId, accessToken, apiVersion };
  }

  async resolveEmail(tenantId: string, override?: EmailOverride): Promise<ResolvedEmailConfig> {
    const settings = await this.loadSettings(tenantId);
    const tenant = settings.communications?.email;

    // Testing a new host/port must never ride along with the tenant's or
    // platform's real credentials for a caller-chosen destination.
    const overrideSetsDestination = override?.host !== undefined || override?.port !== undefined;
    // A tenant that has touched Email at all owns it outright — see the
    // class doc comment for why this can't fall back to env per field.
    const tenantOwnsIt =
      !overrideSetsDestination &&
      (tenant?.host !== undefined ||
        tenant?.port !== undefined ||
        tenant?.user !== undefined ||
        tenant?.password !== undefined);

    let host: string | undefined;
    let port: number | undefined;
    let user: string | undefined;
    let password: string | null | undefined;

    if (overrideSetsDestination) {
      const missing = (['host', 'port', 'user', 'password'] as const).filter(
        (field) => override?.[field] === undefined,
      );
      if (missing.length > 0) {
        throw new ProviderNotConfiguredError(
          'Email',
          `Testing a new host or port requires host, port, user, and password together (missing: ${missing.join(', ')}) — they aren't filled in from stored settings when the destination changes.`,
        );
      }
      host = override!.host;
      port = override!.port;
      user = override!.user;
      password = override!.password;
    } else if (tenantOwnsIt) {
      host = override?.host ?? tenant?.host;
      port = override?.port ?? tenant?.port;
      user = override?.user ?? tenant?.user;
      password = override?.password ?? tenant?.password;
    } else {
      host = override?.host ?? this.config.get<string>('SMTP_HOST');
      port = override?.port ?? Number(this.config.get<string>('SMTP_PORT') ?? DEFAULT_SMTP_PORT);
      user = override?.user ?? this.config.get<string>('SMTP_USER');
      password = override?.password ?? this.config.get<string>('SMTP_PASSWORD');
    }
    // `from` is neither a secret nor a destination — mixing its source
    // carries no security risk, so it keeps resolving independently.
    const from = override?.from ?? tenant?.from ?? this.config.get<string>('SMTP_FROM');

    if (!host || port === undefined || !user || !password || !from) {
      throw new ProviderNotConfiguredError(
        'Email',
        tenantOwnsIt
          ? "Complete host, port, user, and password together on this school's settings — a partially-configured medium never falls back to the platform account."
          : "Configure it on this school's settings, or set SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM as a platform-wide fallback.",
      );
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ProviderNotConfiguredError(
        'Email',
        'SMTP port must be an integer between 1 and 65535.',
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

    const tenantOwnsIt = tenant?.pageId !== undefined || tenant?.accessToken !== undefined;

    const pageId = tenantOwnsIt
      ? (override?.pageId ?? tenant?.pageId)
      : (override?.pageId ?? this.config.get<string>('MESSENGER_PAGE_ID'));
    const accessToken = tenantOwnsIt
      ? (override?.accessToken ?? tenant?.accessToken)
      : (override?.accessToken ?? this.config.get<string>('MESSENGER_ACCESS_TOKEN'));

    if (!pageId || !accessToken) {
      throw new ProviderNotConfiguredError(
        'Messenger',
        tenantOwnsIt
          ? "Complete Messenger's page ID and access token together on this school's settings — a partially-configured medium never falls back to the platform account."
          : "Configure it on this school's settings, or set MESSENGER_PAGE_ID/MESSENGER_ACCESS_TOKEN as a platform-wide fallback.",
      );
    }

    return { pageId, accessToken };
  }

  async resolveSms(tenantId: string, override?: SmsOverride): Promise<ResolvedSmsConfig> {
    const settings = await this.loadSettings(tenantId);
    const tenant = settings.communications?.sms;

    const gateway =
      override?.provider ??
      tenant?.provider ??
      this.config.get<string>('SMS_PROVIDER') ??
      DEFAULT_SMS_GATEWAY;

    if (gateway !== 'greenweb' && gateway !== 'mimsms') {
      throw new ProviderNotConfiguredError(
        'SMS',
        `Unrecognized SMS gateway "${gateway}" — set SMS_PROVIDER (or this school's settings) to "greenweb" or "mimsms".`,
      );
    }

    if (gateway === 'mimsms') {
      const overrideSetsDestination = override?.mimsms?.apiUrl !== undefined;
      const tenantOwnsIt =
        !overrideSetsDestination &&
        (tenant?.mimsms?.apiKey !== undefined ||
          tenant?.mimsms?.senderId !== undefined ||
          tenant?.mimsms?.apiUrl !== undefined);

      let apiKey: string | null | undefined;
      let senderId: string | null | undefined;
      let apiUrl: string | undefined;

      if (overrideSetsDestination) {
        const missing = (['apiKey', 'senderId', 'apiUrl'] as const).filter(
          (field) => override?.mimsms?.[field] === undefined,
        );
        if (missing.length > 0) {
          throw new ProviderNotConfiguredError(
            'SMS (MimSMS)',
            `Testing a new apiUrl requires apiKey, senderId, and apiUrl together (missing: ${missing.join(', ')}) — they aren't filled in from stored settings when the destination changes.`,
          );
        }
        apiKey = override!.mimsms!.apiKey;
        senderId = override!.mimsms!.senderId;
        apiUrl = override!.mimsms!.apiUrl;
      } else if (tenantOwnsIt) {
        apiKey = override?.mimsms?.apiKey ?? tenant?.mimsms?.apiKey;
        senderId = override?.mimsms?.senderId ?? tenant?.mimsms?.senderId;
        apiUrl = override?.mimsms?.apiUrl ?? tenant?.mimsms?.apiUrl;
      } else {
        apiKey = override?.mimsms?.apiKey ?? this.config.get<string>('MIMSMS_API_KEY');
        senderId = override?.mimsms?.senderId ?? this.config.get<string>('MIMSMS_SENDER_ID');
        apiUrl = override?.mimsms?.apiUrl ?? this.config.get<string>('MIMSMS_API_URL');
      }

      if (!apiKey || !senderId) {
        throw new ProviderNotConfiguredError(
          'SMS (MimSMS)',
          tenantOwnsIt
            ? "Complete MimSMS's apiKey and senderId together on this school's settings — a partially-configured medium never falls back to the platform account."
            : "Configure it on this school's settings, or set MIMSMS_API_KEY/MIMSMS_SENDER_ID as a platform-wide fallback.",
        );
      }
      return { gateway: 'mimsms', apiKey, senderId, ...(apiUrl ? { apiUrl } : {}) };
    }

    // greenweb
    const overrideSetsDestination = override?.greenweb?.apiUrl !== undefined;
    const tenantOwnsIt =
      !overrideSetsDestination &&
      (tenant?.greenweb?.apiKey !== undefined || tenant?.greenweb?.apiUrl !== undefined);

    let apiKey: string | null | undefined;
    let apiUrl: string | undefined;

    if (overrideSetsDestination) {
      if (override?.greenweb?.apiKey === undefined) {
        throw new ProviderNotConfiguredError(
          'SMS (Greenweb)',
          "Testing a new apiUrl requires apiKey in the same request — it isn't filled in from stored settings when the destination changes.",
        );
      }
      apiKey = override.greenweb.apiKey;
      apiUrl = override.greenweb.apiUrl;
    } else if (tenantOwnsIt) {
      apiKey = override?.greenweb?.apiKey ?? tenant?.greenweb?.apiKey;
      apiUrl = override?.greenweb?.apiUrl ?? tenant?.greenweb?.apiUrl;
    } else {
      apiKey = override?.greenweb?.apiKey ?? this.config.get<string>('GREENWEB_API_KEY');
      apiUrl = override?.greenweb?.apiUrl ?? this.config.get<string>('GREENWEB_API_URL');
    }

    if (!apiKey) {
      throw new ProviderNotConfiguredError(
        'SMS (Greenweb)',
        tenantOwnsIt
          ? "Complete Greenweb's apiKey on this school's settings — a partially-configured medium never falls back to the platform account."
          : "Configure it on this school's settings, or set GREENWEB_API_KEY as a platform-wide fallback.",
      );
    }
    return { gateway: 'greenweb', apiKey, ...(apiUrl ? { apiUrl } : {}) };
  }
}
