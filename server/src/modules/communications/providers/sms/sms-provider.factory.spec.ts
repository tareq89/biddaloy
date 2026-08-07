import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmsProviderFactory } from './sms-provider.factory';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';

describe('SmsProviderFactory', () => {
  const tenantId = 'tenant-1';
  let configResolver: Record<string, ReturnType<typeof vi.fn>>;
  let greenweb: Record<string, ReturnType<typeof vi.fn>>;
  let mimSms: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    configResolver = { resolveSms: vi.fn() };
    greenweb = {
      sendSms: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'gw-1' }),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'gw-ok' }),
    };
    mimSms = {
      sendSms: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'mim-1' }),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'mim-ok' }),
    };
  });

  it('routes to the MimSMS gateway when resolved config selects mimsms', async () => {
    configResolver.resolveSms.mockResolvedValue({
      gateway: 'mimsms',
      apiKey: 'key',
      senderId: 'sender',
    });
    const factory = new SmsProviderFactory(configResolver as any, greenweb as any, mimSms as any);

    const result = await factory.send({ to: '01712345678', body: 'hi' }, tenantId);

    expect(configResolver.resolveSms).toHaveBeenCalledWith(tenantId);
    expect(mimSms.sendSms).toHaveBeenCalledWith('01712345678', 'hi', {
      gateway: 'mimsms',
      apiKey: 'key',
      senderId: 'sender',
    });
    expect(greenweb.sendSms).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('routes to the Greenweb gateway when resolved config selects greenweb', async () => {
    configResolver.resolveSms.mockResolvedValue({ gateway: 'greenweb', apiKey: 'key' });
    const factory = new SmsProviderFactory(configResolver as any, greenweb as any, mimSms as any);

    const result = await factory.send({ to: '01712345678', body: 'hi' }, tenantId);

    expect(greenweb.sendSms).toHaveBeenCalledWith('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key',
    });
    expect(mimSms.sendSms).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('returns a failure result instead of throwing when the tenant is unconfigured', async () => {
    configResolver.resolveSms.mockRejectedValue(
      new ProviderNotConfiguredError('SMS (Greenweb)', 'configure it'),
    );
    const factory = new SmsProviderFactory(configResolver as any, greenweb as any, mimSms as any);

    const result = await factory.send({ to: '01712345678', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/configure it/);
    expect(greenweb.sendSms).not.toHaveBeenCalled();
    expect(mimSms.sendSms).not.toHaveBeenCalled();
  });

  describe('testConnection', () => {
    it('routes to the MimSMS gateway when resolved config selects mimsms', async () => {
      configResolver.resolveSms.mockResolvedValue({
        gateway: 'mimsms',
        apiKey: 'key',
        senderId: 'sender',
      });
      const factory = new SmsProviderFactory(configResolver as any, greenweb as any, mimSms as any);

      const result = await factory.testConnection(tenantId);

      expect(configResolver.resolveSms).toHaveBeenCalledWith(tenantId, undefined);
      expect(mimSms.testConnection).toHaveBeenCalledWith({
        gateway: 'mimsms',
        apiKey: 'key',
        senderId: 'sender',
      });
      expect(greenweb.testConnection).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: 'mim-ok' });
    });

    it('routes to the Greenweb gateway when resolved config selects greenweb', async () => {
      configResolver.resolveSms.mockResolvedValue({ gateway: 'greenweb', apiKey: 'key' });
      const factory = new SmsProviderFactory(configResolver as any, greenweb as any, mimSms as any);

      const result = await factory.testConnection(tenantId);

      expect(greenweb.testConnection).toHaveBeenCalledWith({ gateway: 'greenweb', apiKey: 'key' });
      expect(mimSms.testConnection).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: 'gw-ok' });
    });

    it('passes an override through to the resolver so unsaved config can be tested', async () => {
      configResolver.resolveSms.mockResolvedValue({ gateway: 'greenweb', apiKey: 'draft-key' });
      const factory = new SmsProviderFactory(configResolver as any, greenweb as any, mimSms as any);
      const override = { greenweb: { apiKey: 'draft-key' } };

      await factory.testConnection(tenantId, override as any);

      expect(configResolver.resolveSms).toHaveBeenCalledWith(tenantId, override);
    });

    it('returns a failure result instead of throwing when the tenant is unconfigured', async () => {
      configResolver.resolveSms.mockRejectedValue(
        new ProviderNotConfiguredError('SMS (Greenweb)', 'configure it'),
      );
      const factory = new SmsProviderFactory(configResolver as any, greenweb as any, mimSms as any);

      const result = await factory.testConnection(tenantId);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/configure it/);
      expect(greenweb.testConnection).not.toHaveBeenCalled();
      expect(mimSms.testConnection).not.toHaveBeenCalled();
    });
  });
});
