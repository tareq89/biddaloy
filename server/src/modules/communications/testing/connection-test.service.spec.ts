import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunicationMedium } from '@beton-boi/shared';
import { ConnectionTestService } from './connection-test.service';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';

describe('ConnectionTestService', () => {
  const tenantId = 'tenant-1';
  let configResolver: Record<string, ReturnType<typeof vi.fn>>;
  let whatsapp: Record<string, ReturnType<typeof vi.fn>>;
  let email: Record<string, ReturnType<typeof vi.fn>>;
  let sms: Record<string, ReturnType<typeof vi.fn>>;
  let messenger: Record<string, ReturnType<typeof vi.fn>>;
  let service: ConnectionTestService;

  beforeEach(() => {
    configResolver = {
      resolveWhatsApp: vi
        .fn()
        .mockResolvedValue({ phoneNumberId: 'p', accessToken: 't', apiVersion: 'v1' }),
      resolveEmail: vi
        .fn()
        .mockResolvedValue({ host: 'h', port: 587, user: 'u', password: 'p', from: 'f' }),
      resolveMessenger: vi.fn().mockResolvedValue({ pageId: 'p', accessToken: 't' }),
    };
    whatsapp = { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'wa-ok' }) };
    email = { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'email-ok' }) };
    sms = { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'sms-ok' }) };
    messenger = {
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'messenger-ok' }),
    };
    service = new ConnectionTestService(
      configResolver as any,
      whatsapp as any,
      email as any,
      sms as any,
      messenger as any,
    );
  });

  it('resolves and tests WhatsApp', async () => {
    const result = await service.test(tenantId, CommunicationMedium.WHATSAPP);

    expect(configResolver.resolveWhatsApp).toHaveBeenCalledWith(tenantId, undefined);
    expect(whatsapp.testConnection).toHaveBeenCalledWith({
      phoneNumberId: 'p',
      accessToken: 't',
      apiVersion: 'v1',
    });
    expect(result).toEqual({ success: true, message: 'wa-ok' });
  });

  it('resolves and tests Email', async () => {
    const result = await service.test(tenantId, CommunicationMedium.EMAIL);

    expect(configResolver.resolveEmail).toHaveBeenCalledWith(tenantId, undefined);
    expect(result).toEqual({ success: true, message: 'email-ok' });
  });

  it('resolves and tests Messenger', async () => {
    const result = await service.test(tenantId, CommunicationMedium.MESSENGER);

    expect(configResolver.resolveMessenger).toHaveBeenCalledWith(tenantId, undefined);
    expect(result).toEqual({ success: true, message: 'messenger-ok' });
  });

  it('delegates SMS straight to SmsProviderFactory.testConnection, which does its own resolving', async () => {
    const override = { provider: 'mimsms' };

    const result = await service.test(tenantId, CommunicationMedium.SMS, override);

    expect(sms.testConnection).toHaveBeenCalledWith(tenantId, override);
    expect(result).toEqual({ success: true, message: 'sms-ok' });
  });

  it('passes an unsaved override through to the resolver', async () => {
    const override = { accessToken: 'draft-token' };

    await service.test(tenantId, CommunicationMedium.WHATSAPP, override);

    expect(configResolver.resolveWhatsApp).toHaveBeenCalledWith(tenantId, override);
  });

  it('returns a failure result instead of throwing when the tenant is unconfigured', async () => {
    configResolver.resolveWhatsApp.mockRejectedValue(
      new ProviderNotConfiguredError('WhatsApp', 'configure it'),
    );

    const result = await service.test(tenantId, CommunicationMedium.WHATSAPP);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/configure it/);
    expect(whatsapp.testConnection).not.toHaveBeenCalled();
  });
});
