import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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

  describe('testConnection', () => {
    const config = { pageId: '10001', accessToken: 'super-secret-token' };
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('fetches the page metadata instead of sending a message', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: '10001' }) });

      const result = await provider.testConnection(config);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/10001?fields=id');
      expect(init.headers.Authorization).toBe('Bearer super-secret-token');
      expect(result).toEqual({ success: true, message: 'Connected — Facebook Page verified.' });
    });

    it('rejects a page id that is not a plain numeric Graph API id, without making a request', async () => {
      const result = await provider.testConnection({ ...config, pageId: '10001/../evil' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        message: 'Page ID is not a valid Facebook Page identifier.',
      });
    });

    it('reports an actionable message for an invalid token, never the raw payload', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 190, message: `Invalid token: ${config.accessToken}` },
        }),
      });

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication rejected — check the access token.');
      expect(result.message).not.toContain(config.accessToken);
    });

    it('returns success: false instead of throwing on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the Facebook Graph API.');
    });
  });
});
