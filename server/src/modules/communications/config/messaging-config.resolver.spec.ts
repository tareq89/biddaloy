import { describe, it, expect, vi } from 'vitest';
import { CommunicationMedium, type TenantSettings } from '@biddaloy/shared';
import { MessagingConfigResolver } from './messaging-config.resolver';
import { ProviderNotConfiguredError } from './provider-not-configured.error';
import { GreenwebProvider } from '../providers/sms/greenweb.provider';
import { MimsmsProvider } from '../providers/sms/mimsms.provider';
import { MetaCloudProvider } from '../providers/whatsapp/meta-cloud.provider';
import { SmtpProvider } from '../providers/email/smtp.provider';
import { MetaPageProvider } from '../providers/messenger/meta-page.provider';
import { OnecodesoftProvider } from '../providers/sms/onecodesoft.provider';
import type { MessagingProvider } from '../providers/messaging-provider';

const providers = [
  new GreenwebProvider(),
  new MimsmsProvider(),
  new MetaCloudProvider(),
  new SmtpProvider(),
  new MetaPageProvider(),
];

function resolverFor(
  settingsByTenant: Record<string, TenantSettings>,
  env: Record<string, string | undefined> = {},
  list: MessagingProvider<any>[] = providers,
) {
  const schools = {
    getDecryptedSettings: vi.fn(async (id: string) => settingsByTenant[id] ?? { version: 1 }),
  };
  // Pass-through cache: no TTL behaviour under test here.
  const cache = { getOrLoad: vi.fn((_id: string, load: () => Promise<unknown>) => load()) };
  const config = { get: vi.fn((k: string) => env[k]) };
  return new MessagingConfigResolver(schools as any, cache as any, config as any, list);
}

const settingsWith = (medium: string, block: Record<string, unknown>): TenantSettings =>
  ({ version: 1, communications: { [medium]: block } }) as unknown as TenantSettings;

/**
 * One row per provider. `full` = every field the tenant saves; `env` = the platform's keys;
 * `flat` = the pre-D6 shape (only WhatsApp / Email / Messenger ever stored it).
 */
interface Row {
  name: string;
  medium: CommunicationMedium;
  key: string; // settings key of the medium
  full: Record<string, string>;
  expected: Record<string, string>;
  env: Record<string, string>;
  partialDrop: string; // required field removed to make a partial block
  destination?: { field: string; value: string };
  flat?: Record<string, unknown>;
}

const rows: Row[] = [
  {
    name: 'greenweb',
    medium: CommunicationMedium.SMS,
    key: 'sms',
    full: { apiKey: 'tk', apiUrl: 'https://g.example/api' },
    expected: { apiKey: 'tk', apiUrl: 'https://g.example/api' },
    env: { GREENWEB_API_KEY: 'env-k', SMS_PROVIDER: 'greenweb' },
    partialDrop: 'apiKey',
    destination: { field: 'apiUrl', value: 'https://new.example/api' },
  },
  {
    name: 'mimsms',
    medium: CommunicationMedium.SMS,
    key: 'sms',
    full: { apiKey: 'tk', senderId: 'S1', apiUrl: 'https://m.example/api' },
    expected: { apiKey: 'tk', senderId: 'S1', apiUrl: 'https://m.example/api' },
    env: { MIMSMS_API_KEY: 'env-k', MIMSMS_SENDER_ID: 'ENV', SMS_PROVIDER: 'mimsms' },
    partialDrop: 'senderId',
    destination: { field: 'apiUrl', value: 'https://new.example/api' },
  },
  {
    name: 'meta-cloud',
    medium: CommunicationMedium.WHATSAPP,
    key: 'whatsapp',
    full: { phoneNumberId: '123', accessToken: 'tk', apiVersion: 'v99.0' },
    expected: { phoneNumberId: '123', accessToken: 'tk', apiVersion: 'v99.0' },
    env: { WHATSAPP_PHONE_NUMBER_ID: '999', WHATSAPP_ACCESS_TOKEN: 'env-tk' },
    partialDrop: 'accessToken',
    flat: { phoneNumberId: '123', accessToken: 'tk', apiVersion: 'v99.0' },
  },
  {
    name: 'smtp',
    medium: CommunicationMedium.EMAIL,
    key: 'email',
    full: { host: 'smtp.example', port: '2525', user: 'u', password: 'pw', from: 'a@x.com' },
    expected: { host: 'smtp.example', port: '2525', user: 'u', password: 'pw', from: 'a@x.com' },
    env: {
      SMTP_HOST: 'env.example',
      SMTP_PORT: '587',
      SMTP_USER: 'eu',
      SMTP_PASSWORD: 'epw',
      SMTP_FROM: 'e@x.com',
    },
    partialDrop: 'password',
    destination: { field: 'host', value: 'attacker.example' },
    flat: { host: 'smtp.example', port: 2525, user: 'u', password: 'pw', from: 'a@x.com' },
  },
  {
    name: 'meta-page',
    medium: CommunicationMedium.MESSENGER,
    key: 'messenger',
    full: { pageId: '55', accessToken: 'tk' },
    expected: { pageId: '55', accessToken: 'tk' },
    env: { MESSENGER_PAGE_ID: '77', MESSENGER_ACCESS_TOKEN: 'env-tk' },
    partialDrop: 'accessToken',
    flat: { pageId: '55', accessToken: 'tk' },
  },
];

describe('MessagingConfigResolver', () => {
  describe.each(rows)('$name', (row) => {
    // SMS has two vendors, so the tenant names one; the others default to their sole provider.
    const nested = (fields: Record<string, unknown>) =>
      settingsWith(row.key, { provider: row.name, [row.name]: fields });
    const selectIf = row.medium === CommunicationMedium.SMS ? { provider: row.name } : {};

    it('tenant-owned: resolves every saved field and returns this provider', async () => {
      const r = await resolverFor({ t1: nested(row.full) }).resolve(row.medium, 't1');
      expect(r.provider.descriptor.name).toBe(row.name);
      expect(r.config).toEqual(row.expected);
    });

    it('tenant-owned: never leaks into another tenant', async () => {
      const resolver = resolverFor({ t1: nested(row.full) });
      await expect(resolver.resolve(row.medium, 't2')).rejects.toBeInstanceOf(
        ProviderNotConfiguredError,
      );
    });

    it('platform: reads <PREFIX>_<FIELD> env when the tenant has no config', async () => {
      const settings =
        row.medium === CommunicationMedium.SMS
          ? settingsWith('sms', { metering: 'PLATFORM' })
          : { version: 1 };
      const r = await resolverFor({ t1: settings as TenantSettings }, row.env).resolve(
        row.medium,
        't1',
      );
      expect(r.provider.descriptor.name).toBe(row.name);
      // every platform env var shows up as the matching field
      const prefix = r.provider.envPrefix;
      for (const [envKey, value] of Object.entries(row.env)) {
        if (!envKey.startsWith(`${prefix}_`)) continue;
        const field = envKey
          .slice(prefix.length + 1)
          .toLowerCase()
          .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        expect(r.config[field]).toBe(value);
      }
    });

    it('override: wins over the tenant value, field by field', async () => {
      const field = Object.keys(row.full).find((k) => !['host', 'port', 'apiUrl'].includes(k))!;
      const r = await resolverFor({ t1: nested(row.full) }).resolve(row.medium, 't1', {
        override: { ...selectIf, [row.name]: { [field]: 'draft' } },
      });
      expect(r.config[field]).toBe('draft');
      for (const [k, v] of Object.entries(row.expected))
        if (k !== field) expect(r.config[k]).toBe(v);
    });

    it('partial: a tenant that touched the medium never falls back to platform env', async () => {
      const { [row.partialDrop]: _dropped, ...partial } = row.full;
      const resolver = resolverFor({ t1: nested(partial) }, row.env);
      const err = await resolver.resolve(row.medium, 't1').catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/never falls back to the platform account/);
    });

    it('partial: an explicitly cleared secret fails closed, env is not used', async () => {
      const secret = row.partialDrop;
      const resolver = resolverFor({ t1: nested({ ...row.full, [secret]: null }) }, row.env);
      await expect(resolver.resolve(row.medium, 't1')).rejects.toThrow(
        /never falls back to the platform account/,
      );
    });

    if (row.destination) {
      it('override sets the destination: must carry every required field, nothing borrowed', async () => {
        const resolver = resolverFor({ t1: nested(row.full) }, row.env);
        const err = await resolver
          .resolve(row.medium, 't1', {
            override: {
              ...selectIf,
              [row.name]: { [row.destination!.field]: row.destination!.value },
            },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/requires .* together \(missing: /);
        // the stored secret is never in the error
        expect(err.message).not.toContain('pw');
      });

      it('override sets the destination with a full draft: resolves from the draft alone', async () => {
        const draft = { ...row.full, [row.destination!.field]: row.destination!.value };
        const r = await resolverFor({ t1: nested({ ...row.full, apiKey: 'stored' }) }).resolve(
          row.medium,
          't1',
          { override: { ...selectIf, [row.name]: draft } },
        );
        expect(r.config[row.destination!.field]).toBe(row.destination!.value);
      });
    }

    if (row.medium === CommunicationMedium.SMS) {
      it('not-on-credit: no own gateway, not PLATFORM-metered, no allowPlatformKeys -> notOnCredit', async () => {
        const resolver = resolverFor({ t1: settingsWith('sms', { provider: row.name }) }, row.env);
        await expect(resolver.resolve(row.medium, 't1')).rejects.toThrow(
          /not on prepaid SMS credit/,
        );
      });

      it('allowPlatformKeys: an account-access send uses the platform keys without metering', async () => {
        const resolver = resolverFor({ t1: settingsWith('sms', { provider: row.name }) }, row.env);
        const r = await resolver.resolve(row.medium, 't1', { allowPlatformKeys: true });
        expect(r.config.apiKey).toBe('env-k');
      });
    } else {
      it('platform fallback is always on for a medium without metering', async () => {
        const r = await resolverFor({ t1: { version: 1 } }, row.env).resolve(row.medium, 't1');
        expect(Object.keys(r.config).length).toBeGreaterThan(0);
      });
    }

    if (row.flat) {
      it('old flat shape (pre-D6) still resolves', async () => {
        const r = await resolverFor({ t1: settingsWith(row.key, row.flat!) }).resolve(
          row.medium,
          't1',
        );
        expect(r.config).toEqual(row.expected);
      });

      it('old flat shape: nested block wins when both exist', async () => {
        const r = await resolverFor({
          t1: settingsWith(row.key, { ...row.flat!, [row.name]: row.full }),
        }).resolve(row.medium, 't1');
        expect(r.config).toEqual(row.expected);
      });
    }
  });

  describe('provider selection', () => {
    it('unknown provider name: fixed error, the name is not echoed', async () => {
      const resolver = resolverFor({
        t1: settingsWith('sms', { provider: 'evil<script>' }),
      });
      const err = await resolver.resolve(CommunicationMedium.SMS, 't1').catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).not.toContain('evil');
    });

    it('unknown provider name in an override is not echoed either', async () => {
      const err = await resolverFor({})
        .resolve(CommunicationMedium.SMS, 't1', { override: { provider: 'nope-vendor' } })
        .catch((e) => e);
      expect(err.message).not.toContain('nope-vendor');
    });

    it('a single-provider medium ignores a stray provider key (tenant and override)', async () => {
      const stray = settingsWith('whatsapp', {
        provider: 'x',
        'meta-cloud': { phoneNumberId: 'p1', accessToken: 'tok' },
      });
      const r = await resolverFor({ t1: stray }).resolve(CommunicationMedium.WHATSAPP, 't1');
      expect(r.provider.descriptor.name).toBe('meta-cloud');
      const o = await resolverFor({ t1: stray }).resolve(CommunicationMedium.WHATSAPP, 't1', {
        override: { provider: 'nope-vendor' },
      });
      expect(o.provider.descriptor.name).toBe('meta-cloud');
    });

    it('a provider of another medium is not selectable', async () => {
      await expect(
        resolverFor({}).resolve(CommunicationMedium.SMS, 't1', { override: { provider: 'smtp' } }),
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    });

    it('a medium with no provider (PHONE_CALL) is the same fixed error', async () => {
      await expect(resolverFor({}).resolve(CommunicationMedium.PHONE_CALL, 't1')).rejects.toThrow(
        ProviderNotConfiguredError,
      );
    });

    it('SMS with two vendors: the platform picks by SMS_PROVIDER', async () => {
      const r = await resolverFor(
        {},
        { SMS_PROVIDER: 'mimsms', MIMSMS_API_KEY: 'k', MIMSMS_SENDER_ID: 's' },
      ).resolve(CommunicationMedium.SMS, null, { allowPlatformKeys: true });
      expect(r.provider.descriptor.name).toBe('mimsms');
    });

    it('SMS with two vendors and no choice defaults to the first (greenweb)', async () => {
      const r = await resolverFor({}, { GREENWEB_API_KEY: 'k' }).resolve(
        CommunicationMedium.SMS,
        null,
        { allowPlatformKeys: true },
      );
      expect(r.provider.descriptor.name).toBe('greenweb');
    });

    it('tenant provider choice beats SMS_PROVIDER', async () => {
      const r = await resolverFor(
        { t1: settingsWith('sms', { provider: 'greenweb', greenweb: { apiKey: 'k' } }) },
        { SMS_PROVIDER: 'mimsms' },
      ).resolve(CommunicationMedium.SMS, 't1', { allowPlatformKeys: true });
      expect(r.provider.descriptor.name).toBe('greenweb');
    });

    it('platform sender (tenantId null) reads no school settings', async () => {
      const r = await resolverFor(
        {},
        { WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' },
      ).resolve(CommunicationMedium.WHATSAPP, null);
      expect(r.config).toEqual({ phoneNumberId: '1', accessToken: 't' });
    });
  });

  describe('settings cache', () => {
    it('reads settings through TenantSettingsCache keyed by tenant id; two tenants never leak', async () => {
      const settingsByTenant: Record<string, TenantSettings> = {
        'tenant-a': settingsWith('messenger', { pageId: '1', accessToken: 'token-a' }),
        'tenant-b': settingsWith('messenger', { pageId: '2', accessToken: 'token-b' }),
      };
      const getOrLoad = vi.fn((_id: string, load: () => Promise<unknown>) => load());
      const resolver = new MessagingConfigResolver(
        { getDecryptedSettings: async (id: string) => settingsByTenant[id] } as any,
        { getOrLoad } as any,
        { get: () => undefined } as any,
        providers,
      );

      const a = await resolver.resolve(CommunicationMedium.MESSENGER, 'tenant-a');
      const b = await resolver.resolve(CommunicationMedium.MESSENGER, 'tenant-b');

      expect(getOrLoad.mock.calls.map((c) => c[0])).toEqual(['tenant-a', 'tenant-b']);
      expect(a.config.accessToken).toBe('token-a');
      expect(b.config.accessToken).toBe('token-b');
    });

    it('the platform sender (null tenant) never touches the cache', async () => {
      const getOrLoad = vi.fn();
      const resolver = new MessagingConfigResolver(
        {} as any,
        { getOrLoad } as any,
        { get: (k: string) => ({ MESSENGER_PAGE_ID: '9', MESSENGER_ACCESS_TOKEN: 't' })[k] } as any,
        providers,
      );

      await resolver.resolve(CommunicationMedium.MESSENGER, null);

      expect(getOrLoad).not.toHaveBeenCalled();
    });
  });

  describe('field rules', () => {
    it('platform email resolves with SMTP_PORT unset (the provider defaults 587)', async () => {
      const r = await resolverFor(
        {},
        { SMTP_HOST: 'h.example', SMTP_USER: 'u', SMTP_PASSWORD: 'p', SMTP_FROM: 'a@x.com' },
      ).resolve(CommunicationMedium.EMAIL, 't1');

      expect(r.config).toEqual({ host: 'h.example', user: 'u', password: 'p', from: 'a@x.com' });
    });

    it('optional non-credential fields (apiVersion) resolve independently of ownership', async () => {
      const r = await resolverFor(
        { t1: settingsWith('whatsapp', { apiVersion: 'v30.0' }) },
        { WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' },
      ).resolve(CommunicationMedium.WHATSAPP, 't1');
      expect(r.config).toEqual({ phoneNumberId: '1', accessToken: 't', apiVersion: 'v30.0' });
    });

    it('owned optional field (senderId): a school with its own key never gets the platform sender id', async () => {
      // PLATFORM metering makes the env reachable, so only the `owned` flag keeps it out.
      const env = { ONECODESOFT_API_KEY: 'env-k', ONECODESOFT_SENDER_ID: 'PLATFORM-ID' };
      const settings = settingsWith('sms', {
        provider: 'onecodesoft',
        metering: 'PLATFORM',
        onecodesoft: { apiKey: 'own-k', apiUrl: 'https://o.example/api' },
      });
      const r = await resolverFor({ t1: settings }, env, [new OnecodesoftProvider()]).resolve(
        CommunicationMedium.SMS,
        't1',
      );
      expect(r.config).toEqual({ apiKey: 'own-k', apiUrl: 'https://o.example/api' });
    });

    it('owned optional field (senderId): the platform account keeps its own sender id', async () => {
      const env = {
        ONECODESOFT_API_KEY: 'env-k',
        ONECODESOFT_API_URL: 'https://p.example/api',
        ONECODESOFT_SENDER_ID: 'PLATFORM-ID',
      };
      const settings = settingsWith('sms', { provider: 'onecodesoft', metering: 'PLATFORM' });
      const r = await resolverFor({ t1: settings }, env, [new OnecodesoftProvider()]).resolve(
        CommunicationMedium.SMS,
        't1',
      );
      expect(r.config.senderId).toBe('PLATFORM-ID');
    });

    it('SMTP port is a destination: an override port never borrows the stored credentials', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const err = await resolverFor({ t1: stored })
        .resolve(CommunicationMedium.EMAIL, 't1', { override: { smtp: { port: '25' } } })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/requires .* together/);
    });

    // Review round 2, item 4: `from` is send-only, so a connection test of a new SMTP server needs
    // only the server and its login. Nothing is borrowed: the stored `from` stays out of the result too.
    it('SMTP connection test with a new destination needs no `from`', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const r = await resolverFor({ t1: stored }).resolve(CommunicationMedium.EMAIL, 't1', {
        override: { smtp: { host: 'new.example', user: 'nu', password: 'npw' } },
        connectionTestOnly: true,
      });
      expect(r.config).toEqual({ host: 'new.example', user: 'nu', password: 'npw' });
    });

    // Review round 3, item 3: a test message really sends, so it needs `from` too; the stored one
    // is never borrowed for a new destination.
    it('a send to a new SMTP destination (no connectionTestOnly) still requires `from`', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const err = await resolverFor({ t1: stored })
        .resolve(CommunicationMedium.EMAIL, 't1', {
          override: { smtp: { host: 'new.example', user: 'nu', password: 'npw' } },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/requires host, user, password, from together \(missing: from\)/);
    });

    // Review round 3, item 5: SMS has several providers and was never stored flat, so flat vendor
    // keys on `communications.sms` are not read (the validator rejects them too).
    it('multi-provider SMS ignores flat vendor keys (tenant and override)', async () => {
      const env = { GREENWEB_API_KEY: 'env-k' };
      const flat = settingsWith('sms', { provider: 'greenweb', apiKey: 'flat-k' });
      const resolver = resolverFor({ t1: flat }, env);
      await expect(resolver.resolve(CommunicationMedium.SMS, 't1')).rejects.toThrow(
        /not on prepaid SMS credit/,
      );
      const r = await resolver.resolve(CommunicationMedium.SMS, 't1', {
        allowPlatformKeys: true,
        override: { provider: 'greenweb', apiKey: 'flat-override' },
      });
      expect(r.config.apiKey).toBe('env-k');
    });

    it('a stored send without an override still requires `from`', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw' },
      });
      await expect(
        resolverFor({ t1: stored }).resolve(CommunicationMedium.EMAIL, 't1'),
      ).rejects.toThrow(/Complete host, user, password, from together/);
    });

    // Review round 2, item 5: '' is "not filled in", so it neither sets a destination nor claims
    // the medium; only an explicit null is the "cleared" marker that fails closed.
    it("a blank override destination ('') does not count as a new destination", async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const r = await resolverFor({ t1: stored }).resolve(CommunicationMedium.EMAIL, 't1', {
        override: { smtp: { host: '', port: '' } },
      });
      expect(r.config).toEqual({
        host: 'smtp.example',
        user: 'u',
        password: 'pw',
        from: 'a@x.com',
      });
    });

    it("a stored blank optional destination ('') does not claim the medium; null still does", async () => {
      const env = {
        SMTP_HOST: 'env.example',
        SMTP_USER: 'eu',
        SMTP_PASSWORD: 'epw',
        SMTP_FROM: 'e@x.com',
      };
      const blank = settingsWith('email', { smtp: { port: '' } });
      const r = await resolverFor({ t1: blank }, env).resolve(CommunicationMedium.EMAIL, 't1');
      expect(r.config.host).toBe('env.example');

      const cleared = settingsWith('email', { smtp: { password: null } });
      await expect(
        resolverFor({ t1: cleared }, env).resolve(CommunicationMedium.EMAIL, 't1'),
      ).rejects.toThrow(/never falls back to the platform account/);
    });

    // Review round 2, item 12: a school that saved only its sender id owns the medium (same as
    // MiMSMS), so the platform key is never used under the school's name: the send fails closed.
    it('a school storing only onecodesoft.senderId fails closed, the platform key is not borrowed', async () => {
      const env = {
        ONECODESOFT_API_KEY: 'env-k',
        ONECODESOFT_API_URL: 'https://p.example/api',
      };
      const settings = settingsWith('sms', {
        provider: 'onecodesoft',
        metering: 'PLATFORM',
        onecodesoft: { senderId: 'SCHOOL' },
      });
      const err = await resolverFor({ t1: settings }, env, [new OnecodesoftProvider()])
        .resolve(CommunicationMedium.SMS, 't1')
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/never falls back to the platform account/);
      expect(err.message).not.toContain('env-k');
    });

    // PR #3325 review, finding 1: an override that sets an owned field on a school with no config of
    // its own must not mix caller-chosen values (from, senderId, apiKey) with the platform's keys.
    describe('override sets an owned field on the platform tier', () => {
      const smtpEnv = {
        SMTP_HOST: 'env.example',
        SMTP_USER: 'eu',
        SMTP_PASSWORD: 'epw',
        SMTP_FROM: 'e@x.com',
      };

      it('an override `from` alone never sends through the platform SMTP login', async () => {
        const err = await resolverFor({}, smtpEnv)
          .resolve(CommunicationMedium.EMAIL, 't1', {
            override: { smtp: { from: 'ceo@bank.example' } },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/must carry .* themselves/);
        expect(err.message).not.toMatch(/epw|env\.example|ceo@bank/);
      });

      it('an override senderId alone never borrows the platform API key (PLATFORM-metered)', async () => {
        const settings = settingsWith('sms', { provider: 'mimsms', metering: 'PLATFORM' });
        const err = await resolverFor(
          { t1: settings },
          { MIMSMS_API_KEY: 'env-k', MIMSMS_SENDER_ID: 'PLATFORM-ID' },
        )
          .resolve(CommunicationMedium.SMS, 't1', { override: { mimsms: { senderId: 'ANYBANK' } } })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/must carry .* themselves/);
      });

      it('a complete override resolves from the override alone and says so (source: override)', async () => {
        const settings = settingsWith('sms', { provider: 'mimsms', metering: 'PLATFORM' });
        const r = await resolverFor(
          { t1: settings },
          { MIMSMS_API_KEY: 'env-k', MIMSMS_SENDER_ID: 'PLATFORM-ID' },
        ).resolve(CommunicationMedium.SMS, 't1', {
          override: { mimsms: { apiKey: 'own-k', senderId: 'OWN' } },
        });
        expect(r.config).toEqual({ apiKey: 'own-k', senderId: 'OWN' });
        expect(r.source).toBe('override');
      });

      it('an override of only non-owned fields still uses the platform keys (source: platform)', async () => {
        const r = await resolverFor({}, smtpEnv).resolve(CommunicationMedium.EMAIL, 't1', {
          override: { smtp: {} },
        });
        expect(r.config).toEqual({
          host: 'env.example',
          user: 'eu',
          password: 'epw',
          from: 'e@x.com',
        });
        expect(r.source).toBe('platform');
      });

      // Deliberately not applied to the tenant tier: the settings form always sends the non-secret
      // owned fields and leaves out unchanged secrets, so "test my saved config" must keep working.
      // Mixing an override with the school's OWN stored login borrows nothing from the platform.
      it("tenant tier: an override `from` still resolves with the school's stored login (source: tenant)", async () => {
        const stored = settingsWith('email', {
          smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
        });
        const r = await resolverFor({ t1: stored }, smtpEnv).resolve(
          CommunicationMedium.EMAIL,
          't1',
          {
            override: { smtp: { from: 'b@x.com' } },
          },
        );
        expect(r.config).toEqual({
          host: 'smtp.example',
          user: 'u',
          password: 'pw',
          from: 'b@x.com',
        });
        expect(r.source).toBe('tenant');
      });
    });

    it('ignores non-string override values and unknown keys', async () => {
      const err = await resolverFor({})
        .resolve(CommunicationMedium.MESSENGER, 't1', {
          override: { pageId: { $ne: 1 }, accessToken: ['x'], bogus: 'y' },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
    });
  });
});
