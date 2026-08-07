import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GreenwebSmsGateway } from './greenweb-sms.gateway';

describe('GreenwebSmsGateway', () => {
  let gateway: GreenwebSmsGateway;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    gateway = new GreenwebSmsGateway();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a GET request with the resolved config and normalized phone number', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'success', msgid: 'gw-1' }) });

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('token=key-1');
    expect(url).toContain('to=8801712345678');
    expect(result).toEqual({
      success: true,
      providerMessageId: 'gw-1',
      raw: { status: 'success', msgid: 'gw-1' },
    });
  });

  it('uses a tenant-configured apiUrl when given', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'success', msgid: 'gw-2' }) });

    await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
      apiUrl: 'https://custom.example.com/api.php',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/custom\.example\.com\/api\.php\?/);
  });

  it('returns success: false with the provider error message on API failure', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'error', error_msg: 'Insufficient balance' }),
    });

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Insufficient balance');
  });

  it('returns success: false instead of throwing on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
  });
});
