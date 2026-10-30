import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunicationMedium, type ProviderConfigField } from '@biddaloy/shared';
import { SchoolsService } from '../../schools/schools.service';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { isPlainObject } from '../../schools/settings/messaging-descriptors';
import type { MessagingProvider } from '../providers/messaging-provider';
import { ProviderNotConfiguredError } from './provider-not-configured.error';

/** Every registered `MessagingProvider` instance (built in `CommunicationsModule`). */
export const MESSAGING_PROVIDER_INSTANCES = 'MESSAGING_PROVIDER_INSTANCES';

/** One provider's resolved fields. Absent optional fields are omitted, never `undefined`. */
export type ResolvedConfig = Record<string, string>;

/**
 * Same shape as a `communications.<medium>` settings block — `{ provider?, <name>: {...} }`, or
 * the old flat keys (single-provider media only). Untrusted (the test-connection body): only
 * descriptor field keys are read.
 */
export type MessagingOverride = Record<string, unknown>;

export interface ResolveOptions {
  override?: MessagingOverride;
  /** Account-access sends and platform alerts may use the platform's own SMS keys. */
  allowPlatformKeys?: boolean;
  /**
   * The caller only verifies the connection (`testConnection()`), it sends nothing, so an override
   * with a new destination may leave out `sendOnly` fields (an email `from`). Off by default: a send,
   * including a test message, needs every required field.
   */
  connectionTestOnly?: boolean;
}

export interface ResolvedMessaging {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the provider is picked at runtime; its config type is the descriptor's fields
  provider: MessagingProvider<any>;
  config: ResolvedConfig;
}

type FieldValues = Record<string, string | null | undefined>;

const notOnCredit =
  'This school has no SMS gateway of its own and is not on prepaid SMS credit. Add a gateway in Settings › SMS, or ask the platform to turn on SMS credit.';

// A `url` field is always a destination; other kinds say so on the descriptor (`destination: true`).
const isDestination = (f: ProviderConfigField) => f.kind === 'url' || f.destination === true;
// Fields that decide whose account a send uses. Other optional fields (apiVersion) are not
// credentials and resolve independently.
const isOwned = (f: ProviderConfigField) => f.required || f.owned === true || isDestination(f);

const envName = (prefix: string, key: string) =>
  `${prefix}_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;

/** string/number -> string, explicit null stays null (a cleared secret); '' and anything else is unset. */
function coerce(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === 'string') return v === '' ? undefined : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * D6: the nested `<name>` block, else (old flat shape) the field keys on the medium itself. Only a
 * single-provider medium ever stored the flat shape (SMS was already nested before D6), so a
 * multi-provider medium reads the nested block only, as the validator accepts.
 */
function readBlock(
  src: Record<string, unknown>,
  name: string,
  fields: ProviderConfigField[],
  flatOk: boolean,
) {
  const nested = src[name];
  const from = isPlainObject(nested) ? nested : flatOk ? src : {};
  const out: FieldValues = {};
  for (const f of fields) out[f.key] = coerce(from[f.key]);
  return out;
}

/**
 * The one place that implements "override › tenant settings › platform env" for every medium
 * and provider, driven by the provider's descriptor (D1, D6, D11). No vendor names here.
 *
 * Fields do not fall back independently across trust tiers; a medium's source is decided as a unit:
 *   - override sets a destination field (apiUrl, host, port) -> the override must carry every
 *     required field itself (bar `sendOnly` ones when `connectionTestOnly`); it never
 *     borrows stored credentials for a caller-chosen target.
 *   - else tenant set any owned field (even an explicit null clear) -> tenant/override only,
 *     never the platform env (a cleared credential fails closed).
 *   - else platform env, only when `platformOk`.
 * Reads through `TenantSettingsCache`, so a burst of sends costs one decrypt.
 */
@Injectable()
export class MessagingConfigResolver {
  constructor(
    private readonly schools: SchoolsService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly config: ConfigService,
    @Inject(MESSAGING_PROVIDER_INSTANCES)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see ResolvedMessaging
    private readonly providers: MessagingProvider<any>[],
  ) {}

  // null = platform sender (D28): no school settings, so everything falls to the platform env.
  private loadSettings(tenantId: string | null) {
    if (tenantId === null) {
      return Promise.resolve({} as Awaited<ReturnType<SchoolsService['getDecryptedSettings']>>);
    }
    return this.settingsCache.getOrLoad(tenantId, () =>
      this.schools.getDecryptedSettings(tenantId),
    );
  }

  async resolve(
    medium: CommunicationMedium,
    tenantId: string | null,
    opts: ResolveOptions = {},
  ): Promise<ResolvedMessaging> {
    const settings = await this.loadSettings(tenantId);
    const mediumKey = medium.toLowerCase() as 'sms' | 'whatsapp' | 'email' | 'messenger';
    const tenantMedium: Record<string, unknown> = settings.communications?.[mediumKey] ?? {};
    const override = opts.override ?? {};

    // Platform env keys serve PLATFORM-metered SMS schools and account-access sends (D11). The
    // other media have no metering: their env fallback is always on, as before.
    const platformOk =
      medium !== CommunicationMedium.SMS ||
      tenantMedium.metering === 'PLATFORM' ||
      opts.allowPlatformKeys === true;
    const env = (name: string) => (platformOk ? this.config.get<string>(name) : undefined);

    const forMedium = this.providers.filter((p) => p.descriptor.medium === medium);
    // A medium with one provider has nothing to choose: a stray stored/override `provider` key is ignored.
    const selected =
      (forMedium.length === 1 ? forMedium[0].descriptor.name : undefined) ??
      coerce(override.provider) ??
      coerce(tenantMedium.provider) ??
      env(`${medium}_PROVIDER`) ??
      forMedium[0]?.descriptor.name;
    const provider = forMedium.find((p) => p.descriptor.name === selected);
    if (!provider) {
      // Rule 23: the submitted/stored name is never echoed.
      throw new ProviderNotConfiguredError(
        medium,
        "The selected provider is not recognized — choose one from the provider list on this school's settings.",
      );
    }

    const { fields, label } = provider.descriptor;
    const flatOk = forMedium.length === 1;
    const tenant = readBlock(tenantMedium, provider.descriptor.name, fields, flatOk);
    const ov = readBlock(override, provider.descriptor.name, fields, flatOk);
    const overrideSetsDestination = fields.some((f) => isDestination(f) && ov[f.key] != null);
    const tenantOwnsIt =
      !overrideSetsDestination && fields.some((f) => isOwned(f) && tenant[f.key] !== undefined);

    // A connection test of a new destination needs every required field itself, except send-only
    // ones (from); anything that sends (a real send, a test message) needs them all.
    const skipSendOnly = overrideSetsDestination && opts.connectionTestOnly === true;
    const required = fields.filter((f) => f.required && !(skipSendOnly && f.sendOnly === true));
    const envNames = required.map((f) => envName(provider.envPrefix, f.key)).join('/');
    const requiredKeys = required.map((f) => f.key).join(', ');

    const resolved: ResolvedConfig = {};
    for (const f of fields) {
      const e = env(envName(provider.envPrefix, f.key));
      const value = !isOwned(f)
        ? (ov[f.key] ?? tenant[f.key] ?? e)
        : overrideSetsDestination
          ? ov[f.key]
          : tenantOwnsIt
            ? (ov[f.key] ?? tenant[f.key])
            : (ov[f.key] ?? e);
      if (value) resolved[f.key] = value;
    }

    const missing = required.filter((f) => !resolved[f.key]).map((f) => f.key);
    if (missing.length > 0) {
      throw new ProviderNotConfiguredError(
        label.en,
        overrideSetsDestination
          ? `Testing a new destination requires ${requiredKeys} together (missing: ${missing.join(', ')}) — they aren't filled in from stored settings when the destination changes.`
          : tenantOwnsIt
            ? `Complete ${requiredKeys} together on this school's settings — a partially-configured medium never falls back to the platform account.`
            : platformOk
              ? `Configure it on this school's settings, or set ${envNames} as a platform-wide fallback.`
              : notOnCredit,
      );
    }
    return { provider, config: resolved };
  }
}
