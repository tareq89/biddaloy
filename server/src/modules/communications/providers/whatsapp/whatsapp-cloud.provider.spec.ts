import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WhatsAppCloudProvider } from './whatsapp-cloud.provider';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';

describe('WhatsAppCloudProvider', () => {
  const tenantId = 'tenant-1';
  let configResolver: Record<string, ReturnType<typeof vi.fn>>;
  let provider: WhatsAppCloudProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    configResolver = {
      resolveWhatsApp: vi.fn().mockResolvedValue({
        phoneNumberId: 'phone-id-123',
        accessToken: 'token-abc',
        apiVersion: 'v21.0',
      }),
    };
    provider = new WhatsAppCloudProvider(configResolver as any);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a freeform text payload when no template is given', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.1' }] }),
    });

    const result = await provider.send({ to: '01712345678', body: 'Your fee is due' }, tenantId);

    expect(configResolver.resolveWhatsApp).toHaveBeenCalledWith(tenantId);
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(url).toContain('/phone-id-123/messages');
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Your fee is due');
    expect(body.to).toBe('8801712345678');
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('wamid.1');
  });

  it('sends a template payload when template_name is given', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.2' }] }),
    });

    await provider.send(
      {
        to: '01712345678',
        body: 'ignored',
        templateName: 'fee_reminder',
        templateLanguage: 'bn',
        templateParams: ['500', 'August'],
      },
      tenantId,
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.type).toBe('template');
    expect(body.template.name).toBe('fee_reminder');
    expect(body.template.language.code).toBe('bn');
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: '500' },
      { type: 'text', text: 'August' },
    ]);
  });

  it('returns success: false with the Meta error message on API failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Recipient outside the 24-hour window' } }),
    });

    const result = await provider.send({ to: '01712345678', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Recipient outside the 24-hour window');
  });

  it('returns success: false instead of throwing on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await provider.send({ to: '01712345678', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
  });

  it('returns success: false instead of throwing when the tenant is unconfigured', async () => {
    configResolver.resolveWhatsApp.mockRejectedValue(
      new ProviderNotConfiguredError('WhatsApp', 'configure it'),
    );

    const result = await provider.send({ to: '01712345678', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/configure it/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
