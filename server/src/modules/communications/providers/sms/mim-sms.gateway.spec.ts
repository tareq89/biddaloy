import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MimSmsGateway } from './mim-sms.gateway';

// Destination-class validation (real vs. private-network host) is its own
// unit under test in outbound-destination-guard.spec.ts, and does a real
// DNS lookup — stub it out here so these tests stay hermetic and fast.
vi.mock('../shared/outbound-destination-guard', () => ({
  assertSafeHttpDestination: vi.fn().mockResolvedValue(undefined),
}));

describe('MimSmsGateway', () => {
  let gateway: MimSmsGateway;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    gateway = new MimSmsGateway();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a POST request with the resolved config and normalized phone number', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'success', transaction_id: 'mim-1' }),
    });

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'mimsms',
      apiKey: 'key-1',
      senderId: 'sender-1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(url).toBe('https://api.mimsms.com/api/SmsSending/SMS');
    expect(init.method).toBe('POST');
    expect(body.api_key).toBe('key-1');
    expect(body.senderid).toBe('sender-1');
    expect(body.number).toBe('8801712345678');
    expect(result).toEqual({
      success: true,
      providerMessageId: 'mim-1',
      raw: { status: 'success', transaction_id: 'mim-1' },
    });
  });

  it('uses a tenant-configured apiUrl when given', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 'success' }) });

    await gateway.sendSms('01712345678', 'hi', {
      gateway: 'mimsms',
      apiKey: 'key-1',
      senderId: 'sender-1',
      apiUrl: 'https://custom.example.com/sms',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://custom.example.com/sms');
  });

  it('returns success: false with the provider error message on API failure', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'error', message: 'Invalid sender id' }),
    });

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'mimsms',
      apiKey: 'key-1',
      senderId: 'sender-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid sender id');
  });

  it('returns success: false instead of throwing on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'mimsms',
      apiKey: 'key-1',
      senderId: 'sender-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
  });

  describe('testConnection', () => {
    it('checks the account balance instead of sending an SMS', async () => {
      fetchMock.mockResolvedValue({ json: async () => ({ status: 'success', balance: 100 }) });

      const result = await gateway.testConnection({
        gateway: 'mimsms',
        apiKey: 'super-secret-key',
        senderId: 'sender-1',
      });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.mimsms.com/api/User/Balance?api_key=super-secret-key');
      expect(result).toEqual({
        success: true,
        message: 'Connected — MimSMS account credentials verified.',
      });
    });

    it('reports an actionable message on failure, never the raw payload', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'error', message: 'Invalid API key: super-secret-key' }),
      });

      const result = await gateway.testConnection({
        gateway: 'mimsms',
        apiKey: 'super-secret-key',
        senderId: 'sender-1',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication rejected — check the API key.');
      expect(result.message).not.toContain('super-secret-key');
    });

    it('returns success: false instead of throwing on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      const result = await gateway.testConnection({
        gateway: 'mimsms',
        apiKey: 'key-1',
        senderId: 'sender-1',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the MimSMS API.');
    });
  });
});
