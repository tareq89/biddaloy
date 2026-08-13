import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantProviderConfigResolver } from './tenant-provider-config.resolver';
import { ProviderNotConfiguredError } from './provider-not-configured.error';
import type { TenantSettings } from '@biddaloy/shared';

function fakeSchools(settings: TenantSettings) {
  return { getDecryptedSettings: vi.fn().mockResolvedValue(settings) };
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

    it('throws when unconfigured — there is no env-var fallback for Messenger', async () => {
      const resolver = resolverWith(
        { version: 1 },
        // Even with unrelated env vars present, Messenger has no fallback path.
        { WHATSAPP_ACCESS_TOKEN: 'unrelated' },
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
