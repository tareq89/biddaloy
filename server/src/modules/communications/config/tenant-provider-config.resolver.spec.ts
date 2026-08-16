import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantProviderConfigResolver } from './tenant-provider-config.resolver';
import { ProviderNotConfiguredError } from './provider-not-configured.error';
import type { TenantSettings } from '@biddaloy/shared';

function fakeSchools(settings: TenantSettings) {
  return { getDecryptedSettings: vi.fn().mockResolvedValue(settings) };
}

/**
 * Tenant-aware double for `getDecryptedSettings` — resolves whatever
 * settings the map has for the requested tenant id, `{ version: 1 }` for
 * any other tenant. Distinct settings per tenant lets a test prove one
 * tenant's config never leaks into another's resolve call, which a single
 * shared `mockResolvedValue` (the old `fakeSchools`) cannot catch.
 */
function fakeSchoolsByTenant(settingsByTenant: Record<string, TenantSettings>) {
  return {
    getDecryptedSettings: vi.fn(
      async (tenantId: string) => settingsByTenant[tenantId] ?? { version: 1 },
    ),
  };
}

function fakeCache() {
  // Pass-through — no TTL behaviour under test here, that's
  // tenant-settings-cache.service.spec.ts's job. Always calls the loader.
  return { getOrLoad: vi.fn((_id: string, load: () => Promise<unknown>) => load()) };
}

function fakeConfig(env: Record<string, string | undefined>) {
  return { get: vi.fn((key: string) => env[key]) };
}

function resolverWith(
  settings: TenantSettings,
  env: Record<string, string | undefined> = {},
): TenantProviderConfigResolver {
  return new TenantProviderConfigResolver(
    fakeSchools(settings) as any,
    fakeCache() as any,
    fakeConfig(env) as any,
  );
}

describe('TenantProviderConfigResolver', () => {
  describe('resolveWhatsApp', () => {
    it('uses the tenant setting when configured', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          whatsapp: {
            phoneNumberId: 'tenant-phone',
            accessToken: 'tenant-token',
            apiVersion: 'v99',
          },
        },
      });

      const config = await resolver.resolveWhatsApp('school-1');

      expect(config).toEqual({
        phoneNumberId: 'tenant-phone',
        accessToken: 'tenant-token',
        apiVersion: 'v99',
      });
    });

    it('falls back to env vars when the tenant has not configured WhatsApp', async () => {
      const resolver = resolverWith(
        { version: 1 },
        { WHATSAPP_PHONE_NUMBER_ID: 'env-phone', WHATSAPP_ACCESS_TOKEN: 'env-token' },
      );

      const config = await resolver.resolveWhatsApp('school-1');

      expect(config).toEqual({
        phoneNumberId: 'env-phone',
        accessToken: 'env-token',
        apiVersion: 'v21.0',
      });
    });

    it('defaults apiVersion when neither tenant nor env sets it', async () => {
      const resolver = resolverWith(
        { version: 1 },
        { WHATSAPP_PHONE_NUMBER_ID: 'env-phone', WHATSAPP_ACCESS_TOKEN: 'env-token' },
      );

      const config = await resolver.resolveWhatsApp('school-1');

      expect(config.apiVersion).toBe('v21.0');
    });

    it('throws ProviderNotConfiguredError when neither tenant nor env has it', async () => {
      const resolver = resolverWith({ version: 1 }, {});

      await expect(resolver.resolveWhatsApp('school-1')).rejects.toThrow(
        ProviderNotConfiguredError,
      );
    });

    it('lets an override win over the tenant setting, field by field', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          whatsapp: {
            phoneNumberId: 'tenant-phone',
            accessToken: 'tenant-token',
            apiVersion: 'v99',
          },
        },
      });

      const config = await resolver.resolveWhatsApp('school-1', { accessToken: 'draft-token' });

      expect(config).toEqual({
        phoneNumberId: 'tenant-phone',
        accessToken: 'draft-token',
        apiVersion: 'v99',
      });
    });

    it('falls through an override field left unset to the tenant setting, not the env fallback', async () => {
      const resolver = resolverWith(
        {
          version: 1,
          communications: {
            whatsapp: { phoneNumberId: 'tenant-phone', accessToken: 'tenant-token' },
          },
        },
        { WHATSAPP_PHONE_NUMBER_ID: 'env-phone' },
      );

      const config = await resolver.resolveWhatsApp('school-1', { accessToken: 'draft-token' });

      expect(config.phoneNumberId).toBe('tenant-phone');
    });

    it('tests a fully unsaved config via override alone, with nothing stored for the tenant', async () => {
      const resolver = resolverWith({ version: 1 });

      const config = await resolver.resolveWhatsApp('school-1', {
        phoneNumberId: 'draft-phone',
        accessToken: 'draft-token',
      });

      expect(config).toEqual({
        phoneNumberId: 'draft-phone',
        accessToken: 'draft-token',
        apiVersion: 'v21.0',
      });
    });

    it('throws instead of filling a cleared tenant secret from the env fallback', async () => {
      // Tenant explicitly cleared accessToken (null) — the documented way
      // to stop using their own WhatsApp account. Falling back to the
      // platform's WHATSAPP_ACCESS_TOKEN here would silently send under
      // the platform's account instead of failing closed.
      const resolver = resolverWith(
        {
          version: 1,
          communications: { whatsapp: { phoneNumberId: 'tenant-phone', accessToken: null } },
        },
        { WHATSAPP_ACCESS_TOKEN: 'env-token' },
      );

      await expect(resolver.resolveWhatsApp('school-1')).rejects.toThrow(
        ProviderNotConfiguredError,
      );
    });
  });

  describe('resolveEmail', () => {
    it('uses the tenant setting when configured', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          email: {
            host: 'smtp.tenant.example',
            port: 2525,
            user: 'u',
            password: 'p',
            from: 'a@x.com',
          },
        },
      });

      const config = await resolver.resolveEmail('school-1');

      expect(config).toEqual({
        host: 'smtp.tenant.example',
        port: 2525,
        user: 'u',
        password: 'p',
        from: 'a@x.com',
      });
    });

    it('falls back to env vars when unconfigured for the tenant', async () => {
      const resolver = resolverWith(
        { version: 1 },
        {
          SMTP_HOST: 'smtp.env.example',
          SMTP_PORT: '465',
          SMTP_USER: 'env-user',
          SMTP_PASSWORD: 'env-pass',
          SMTP_FROM: 'noreply@env.example',
        },
      );

      const config = await resolver.resolveEmail('school-1');

      expect(config).toEqual({
        host: 'smtp.env.example',
        port: 465,
        user: 'env-user',
        password: 'env-pass',
        from: 'noreply@env.example',
      });
    });

    it('defaults the port to 587 when neither tenant nor env sets one', async () => {
      const resolver = resolverWith(
        { version: 1 },
        { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASSWORD: 'p', SMTP_FROM: 'f@x.com' },
      );

      const config = await resolver.resolveEmail('school-1');

      expect(config.port).toBe(587);
    });

    it('throws when a required field is missing from both tenant and env', async () => {
      const resolver = resolverWith({ version: 1 }, { SMTP_HOST: 'h' });

      await expect(resolver.resolveEmail('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('lets an override win over the tenant setting', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          email: {
            host: 'smtp.tenant.example',
            port: 2525,
            user: 'u',
            password: 'p',
            from: 'a@x.com',
          },
        },
      });

      const config = await resolver.resolveEmail('school-1', { password: 'draft-pass' });

      expect(config.password).toBe('draft-pass');
      expect(config.host).toBe('smtp.tenant.example');
    });

    it('throws when an override changes the host without supplying the rest of the medium', async () => {
      // Testing a new host must never borrow the tenant's or platform's
      // real SMTP credentials for a caller-chosen destination.
      const resolver = resolverWith(
        {
          version: 1,
          communications: {
            email: {
              host: 'smtp.tenant.example',
              port: 587,
              user: 'u',
              password: 'p',
              from: 'a@x.com',
            },
          },
        },
        { SMTP_PASSWORD: 'env-pass' },
      );

      await expect(resolver.resolveEmail('school-1', { host: 'attacker.example' })).rejects.toThrow(
        ProviderNotConfiguredError,
      );
    });

    it('throws when the tenant set a custom host but no password, instead of falling back to the env password', async () => {
      const resolver = resolverWith(
        {
          version: 1,
          communications: {
            email: {
              host: 'smtp.tenant.example',
              port: 587,
              user: 'u',
              from: 'a@x.com',
              password: null,
            },
          },
        },
        { SMTP_PASSWORD: 'env-pass', SMTP_USER: 'env-user' },
      );

      await expect(resolver.resolveEmail('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('still resolves fully from env when the medium is completely untouched', async () => {
      const resolver = resolverWith(
        { version: 1 },
        {
          SMTP_HOST: 'smtp.env.example',
          SMTP_PORT: '465',
          SMTP_USER: 'env-user',
          SMTP_PASSWORD: 'env-pass',
          SMTP_FROM: 'noreply@env.example',
        },
      );

      const config = await resolver.resolveEmail('school-1');

      expect(config).toEqual({
        host: 'smtp.env.example',
        port: 465,
        user: 'env-user',
        password: 'env-pass',
        from: 'noreply@env.example',
      });
    });

    it('rejects a non-numeric port', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          email: {
            host: 'h',
            port: Number('not-a-number'),
            user: 'u',
            password: 'p',
            from: 'a@x.com',
          },
        },
      });

      await expect(resolver.resolveEmail('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('rejects an out-of-range port', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          email: { host: 'h', port: 70000, user: 'u', password: 'p', from: 'a@x.com' },
        },
      });

      await expect(resolver.resolveEmail('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('rejects a string port from an untyped override — the connection-test endpoint accepts unvalidated config', async () => {
      // TestConnectionDto.config is Record<string, unknown> cast to
      // EmailOverride — nothing stops a caller (or an un-coerced form
      // input) from sending port as a string. Number.isInteger('465') is
      // false, so this must be rejected here rather than reaching
      // SmtpEmailProvider, where `secure: config.port === 465` would
      // silently evaluate false for the string and connect without TLS.
      const resolver = resolverWith({ version: 1 });

      await expect(
        resolver.resolveEmail('school-1', {
          host: 'h',
          port: '465' as unknown as number,
          user: 'u',
          password: 'p',
          from: 'a@x.com',
        }),
      ).rejects.toThrow(/SMTP port must be an integer between 1 and 65535/);
    });
  });

  describe('resolveMessenger', () => {
    it('uses the tenant setting when configured', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: { messenger: { pageId: 'p1', accessToken: 't1' } },
      });

      const config = await resolver.resolveMessenger('school-1');

      expect(config).toEqual({ pageId: 'p1', accessToken: 't1' });
    });

    it('falls back to env vars when the tenant has not configured Messenger', async () => {
      const resolver = resolverWith(
        { version: 1 },
        { MESSENGER_PAGE_ID: 'env-page', MESSENGER_ACCESS_TOKEN: 'env-token' },
      );

      const config = await resolver.resolveMessenger('school-1');

      expect(config).toEqual({ pageId: 'env-page', accessToken: 'env-token' });
    });

    it('throws when neither tenant nor env has it', async () => {
      const resolver = resolverWith(
        { version: 1 },
        // Even with unrelated env vars present, this medium is unconfigured.
        { WHATSAPP_ACCESS_TOKEN: 'unrelated' },
      );

      await expect(resolver.resolveMessenger('school-1')).rejects.toThrow(
        ProviderNotConfiguredError,
      );
    });

    it('throws instead of filling a cleared tenant secret from the env fallback', async () => {
      const resolver = resolverWith(
        { version: 1, communications: { messenger: { pageId: 'tenant-page', accessToken: null } } },
        { MESSENGER_ACCESS_TOKEN: 'env-token' },
      );

      await expect(resolver.resolveMessenger('school-1')).rejects.toThrow(
        ProviderNotConfiguredError,
      );
    });

    it('resolves from override alone when the tenant has nothing stored yet', async () => {
      const resolver = resolverWith({ version: 1 });

      const config = await resolver.resolveMessenger('school-1', {
        pageId: 'draft-page',
        accessToken: 'draft-token',
      });

      expect(config).toEqual({ pageId: 'draft-page', accessToken: 'draft-token' });
    });
  });

  describe('resolveSms', () => {
    it('uses the tenant greenweb setting when the tenant selects greenweb', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          sms: {
            provider: 'greenweb',
            greenweb: { apiKey: 'tenant-key', apiUrl: 'https://tenant.example' },
          },
        },
      });

      const config = await resolver.resolveSms('school-1');

      expect(config).toEqual({
        gateway: 'greenweb',
        apiKey: 'tenant-key',
        apiUrl: 'https://tenant.example',
      });
    });

    it('uses the tenant mimsms setting when the tenant selects mimsms', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          sms: { provider: 'mimsms', mimsms: { apiKey: 'tenant-key', senderId: 'S1' } },
        },
      });

      const config = await resolver.resolveSms('school-1');

      expect(config).toEqual({ gateway: 'mimsms', apiKey: 'tenant-key', senderId: 'S1' });
    });

    it('falls back to the env-selected gateway and env credentials when the tenant has none', async () => {
      const resolver = resolverWith(
        { version: 1 },
        { SMS_PROVIDER: 'mimsms', MIMSMS_API_KEY: 'env-key', MIMSMS_SENDER_ID: 'env-sender' },
      );

      const config = await resolver.resolveSms('school-1');

      expect(config).toEqual({ gateway: 'mimsms', apiKey: 'env-key', senderId: 'env-sender' });
    });

    it('defaults to greenweb when neither tenant nor env names a gateway', async () => {
      const resolver = resolverWith({ version: 1 }, { GREENWEB_API_KEY: 'env-key' });

      const config = await resolver.resolveSms('school-1');

      expect(config.gateway).toBe('greenweb');
    });

    it('throws when the selected gateway has no credentials from either source', async () => {
      const resolver = resolverWith({ version: 1 }, { SMS_PROVIDER: 'greenweb' });

      await expect(resolver.resolveSms('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('throws for mimsms when apiKey resolves but senderId does not', async () => {
      const resolver = resolverWith(
        { version: 1 },
        { SMS_PROVIDER: 'mimsms', MIMSMS_API_KEY: 'env-key' },
      );

      await expect(resolver.resolveSms('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('lets an override switch the gateway and supply its own credentials', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          sms: { provider: 'greenweb', greenweb: { apiKey: 'tenant-key' } },
        },
      });

      const config = await resolver.resolveSms('school-1', {
        provider: 'mimsms',
        mimsms: { apiKey: 'draft-key', senderId: 'draft-sender' },
      });

      expect(config).toEqual({ gateway: 'mimsms', apiKey: 'draft-key', senderId: 'draft-sender' });
    });

    it('lets a partial override change just the api key while keeping the tenant gateway selection', async () => {
      const resolver = resolverWith({
        version: 1,
        communications: {
          sms: { provider: 'greenweb', greenweb: { apiKey: 'tenant-key' } },
        },
      });

      const config = await resolver.resolveSms('school-1', { greenweb: { apiKey: 'draft-key' } });

      expect(config).toEqual({ gateway: 'greenweb', apiKey: 'draft-key' });
    });

    it('rejects an unrecognized gateway name instead of silently falling through to greenweb', async () => {
      const resolver = resolverWith(
        { version: 1 },
        { SMS_PROVIDER: 'twilio', GREENWEB_API_KEY: 'env-key' },
      );

      await expect(resolver.resolveSms('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('throws when an override changes the greenweb apiUrl without supplying apiKey', async () => {
      const resolver = resolverWith(
        {
          version: 1,
          communications: { sms: { provider: 'greenweb', greenweb: { apiKey: 'tenant-key' } } },
        },
        { GREENWEB_API_KEY: 'env-key' },
      );

      await expect(
        resolver.resolveSms('school-1', { greenweb: { apiUrl: 'https://attacker.example' } }),
      ).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('throws when the tenant set a custom greenweb apiUrl but no key, instead of falling back to the env key', async () => {
      const resolver = resolverWith(
        {
          version: 1,
          communications: {
            sms: {
              provider: 'greenweb',
              greenweb: { apiUrl: 'https://tenant.example', apiKey: null },
            },
          },
        },
        { GREENWEB_API_KEY: 'env-key' },
      );

      await expect(resolver.resolveSms('school-1')).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('throws when an override changes the mimsms apiUrl without supplying apiKey and senderId', async () => {
      const resolver = resolverWith(
        {
          version: 1,
          communications: {
            sms: { provider: 'mimsms', mimsms: { apiKey: 'tenant-key', senderId: 'S1' } },
          },
        },
        { MIMSMS_API_KEY: 'env-key', MIMSMS_SENDER_ID: 'env-sender' },
      );

      await expect(
        resolver.resolveSms('school-1', { mimsms: { apiUrl: 'https://attacker.example' } }),
      ).rejects.toThrow(ProviderNotConfiguredError);
    });
  });

  describe('tenant isolation', () => {
    it('never lets one tenant see another tenant’s resolved credentials', async () => {
      const schools = fakeSchoolsByTenant({
        'tenant-a': {
          version: 1,
          communications: { sms: { provider: 'greenweb', greenweb: { apiKey: 'tenant-a-key' } } },
        },
        'tenant-b': {
          version: 1,
          communications: { sms: { provider: 'greenweb', greenweb: { apiKey: 'tenant-b-key' } } },
        },
      });
      const resolver = new TenantProviderConfigResolver(
        schools as any,
        fakeCache() as any,
        fakeConfig({}) as any,
      );

      const [configA, configB] = await Promise.all([
        resolver.resolveSms('tenant-a'),
        resolver.resolveSms('tenant-b'),
      ]);

      expect(configA).toMatchObject({ apiKey: 'tenant-a-key' });
      expect(configB).toMatchObject({ apiKey: 'tenant-b-key' });
      expect(schools.getDecryptedSettings).toHaveBeenCalledWith('tenant-a');
      expect(schools.getDecryptedSettings).toHaveBeenCalledWith('tenant-b');
    });
  });

  describe('caching', () => {
    it('reads settings through the shared cache, keyed by tenant id', async () => {
      const settings: TenantSettings = { version: 1 };
      const schools = fakeSchools(settings);
      const cache = fakeCache();
      const resolver = new TenantProviderConfigResolver(
        schools as any,
        cache as any,
        fakeConfig({ WHATSAPP_PHONE_NUMBER_ID: 'p', WHATSAPP_ACCESS_TOKEN: 't' }) as any,
      );

      await resolver.resolveWhatsApp('school-42');

      expect(cache.getOrLoad).toHaveBeenCalledWith('school-42', expect.any(Function));
    });
  });
});
