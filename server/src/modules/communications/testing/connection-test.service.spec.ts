import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import { ConnectionTestService } from './connection-test.service';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';

describe('ConnectionTestService', () => {
  const tenantId = 'tenant-1';
  let registry: { resolveFor: ReturnType<typeof vi.fn> };
  let provider: { testConnection: ReturnType<typeof vi.fn> };
  let service: ConnectionTestService;

  beforeEach(() => {
    provider = { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) };
    registry = { resolveFor: vi.fn().mockResolvedValue({ provider, config: { k: 'v' } }) };
    service = new ConnectionTestService(registry as any);
  });

  it.each([
    CommunicationMedium.SMS,
    CommunicationMedium.WHATSAPP,
    CommunicationMedium.EMAIL,
    CommunicationMedium.MESSENGER,
  ])("resolves this tenant's provider for %s and tests the resolved config", async (medium) => {
    const result = await service.test(tenantId, medium as never);

    // Tenant-scoped: the id the caller passed is the id resolved against.
    expect(registry.resolveFor).toHaveBeenCalledWith(medium, tenantId, { override: undefined });
    expect(provider.testConnection).toHaveBeenCalledWith({ k: 'v' });
    expect(result).toEqual({ success: true, message: 'ok' });
  });

  it('passes an unsaved override through to the resolver', async () => {
    const override = { accessToken: 'draft-token' };

    await service.test(tenantId, CommunicationMedium.WHATSAPP, override);

    expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.WHATSAPP, tenantId, {
      override,
    });
  });

  it('returns a failure result instead of throwing when the tenant is unconfigured', async () => {
    registry.resolveFor.mockRejectedValue(
      new ProviderNotConfiguredError('WhatsApp', 'configure it'),
    );

    const result = await service.test(tenantId, CommunicationMedium.WHATSAPP);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/configure it/);
    expect(provider.testConnection).not.toHaveBeenCalled();
  });

  describe('test inbox (Epic 87, D24)', () => {
    afterEach(() => {
      delete process.env.MESSAGE_SINK;
    });

    it.each([
      CommunicationMedium.WHATSAPP,
      CommunicationMedium.EMAIL,
      CommunicationMedium.MESSENGER,
      CommunicationMedium.SMS,
    ])('returns the fixed success text for %s without resolving any config', async (medium) => {
      process.env.MESSAGE_SINK = 'mailpit';

      const result = await service.test(tenantId, medium as never, { accessToken: 'x' });

      expect(result).toEqual({
        success: true,
        message: 'Test site: messages go to the test inbox',
      });
      expect(registry.resolveFor).not.toHaveBeenCalled();
    });
  });
});
