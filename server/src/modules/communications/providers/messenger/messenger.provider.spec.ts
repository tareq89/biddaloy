import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessengerProvider } from './messenger.provider';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';

describe('MessengerProvider', () => {
  const tenantId = 'tenant-1';
  let configResolver: Record<string, ReturnType<typeof vi.fn>>;
  let provider: MessengerProvider;

  beforeEach(() => {
    configResolver = { resolveMessenger: vi.fn() };
    provider = new MessengerProvider(configResolver as any);
  });

  it('reports "not yet implemented" once the tenant is configured', async () => {
    configResolver.resolveMessenger.mockResolvedValue({ pageId: 'page-1', accessToken: 'token-1' });

    const result = await provider.send({ to: 'psid-1', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Messenger sending is not yet implemented');
  });

  it('reports the tenant-configuration error when Messenger is not configured', async () => {
    configResolver.resolveMessenger.mockRejectedValue(
      new ProviderNotConfiguredError('Messenger', 'configure it in settings'),
    );

    const result = await provider.send({ to: 'psid-1', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/configure it in settings/);
  });
});
