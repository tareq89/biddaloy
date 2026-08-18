import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GreenwebSmsGateway } from './greenweb-sms.gateway';
import {
  assertSafeHttpDestination,
  DestinationBlockedError,
} from '../shared/outbound-destination-guard';
import { fetchPinnedJson } from '../shared/pinned-http';

// Destination-class validation (real vs. private-network host) is its own
// unit under test in outbound-destination-guard.spec.ts, and does a real
// DNS lookup — stub it out here so these tests stay hermetic and fast.
// `assertSafeHttpDestination` echoes the input URL back as `url` so the
// "tenant-configured apiUrl" test below stays meaningful.
vi.mock('../shared/outbound-destination-guard', () => {
  class OutboundDestinationError extends Error {}
  class DestinationBlockedError extends OutboundDestinationError {}
  return {
    assertSafeHttpDestination: vi.fn().mockImplementation(async (rawUrl: string) => ({
      url: new URL(rawUrl),
      addresses: [{ address: '203.0.113.5', family: 4 }],
    })),
    OutboundDestinationError,
    DestinationBlockedError,
  };
});

// The connection-pinning mechanics (undici Client/lookup wiring,
// redirect: 'error', client cleanup) are their own unit under test in
// pinned-http.spec.ts — stub it out here so these tests only assert on
// gateway-level behavior (routing through it vs. a bare fetch, request
// shape, response mapping).
vi.mock('../shared/pinned-http', () => ({ fetchPinnedJson: vi.fn() }));

describe('GreenwebSmsGateway', () => {
  let gateway: GreenwebSmsGateway;
  let fetchMock: ReturnType<typeof vi.fn>;
  let pinnedFetchMock: ReturnType<typeof vi.mocked<typeof fetchPinnedJson>>;

  beforeEach(() => {
    gateway = new GreenwebSmsGateway();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    pinnedFetchMock = vi.mocked(fetchPinnedJson);
    pinnedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a GET request with the resolved config and normalized phone number', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-1' });

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
    });

    const [, url] = pinnedFetchMock.mock.calls[0]!;
    expect(url).toContain('token=key-1');
    expect(url).toContain('to=8801712345678');
    expect(result).toEqual({
      success: true,
      providerMessageId: 'gw-1',
      raw: { status: 'success', msgid: 'gw-1' },
    });
  });

  it('uses a tenant-configured apiUrl when given', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-2' });

    await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
      apiUrl: 'https://custom.example.com/api.php',
    });

    const [, url] = pinnedFetchMock.mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/custom\.example\.com\/api\.php\?/);
  });

  it('returns success: false with the provider error message on API failure', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'error', error_msg: 'Insufficient balance' });

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Insufficient balance');
  });

  it('returns success: false instead of throwing on a network error', async () => {
    pinnedFetchMock.mockRejectedValue(new Error('network down'));

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
    expect(result.retryable).toBeUndefined();
  });

  it('routes through the pinned dispatcher rather than a bare fetch', async () => {
    pinnedFetchMock.mockResolvedValue({ status: 'success', msgid: 'gw-1' });

    await gateway.sendSms('01712345678', 'hi', { gateway: 'greenweb', apiKey: 'key-1' });

    expect(pinnedFetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks a destination-blocked failure as non-retryable', async () => {
    vi.mocked(assertSafeHttpDestination).mockRejectedValueOnce(
      new DestinationBlockedError('"10.0.0.5" is a private/reserved address.'),
    );

    const result = await gateway.sendSms('01712345678', 'hi', {
      gateway: 'greenweb',
      apiKey: 'key-1',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  describe('testConnection', () => {
    it('checks the account balance instead of sending an SMS', async () => {
      pinnedFetchMock.mockResolvedValue({ status: 'success', balance: 100 });

      const result = await gateway.testConnection({
        gateway: 'greenweb',
        apiKey: 'super-secret-key',
      });

      const [, url] = pinnedFetchMock.mock.calls[0]!;
      expect(url).toContain('type=balance');
      expect(url).toContain('token=super-secret-key');
      expect(url).not.toContain('to=');
      expect(url).not.toContain('message=');
      expect(result).toEqual({
        success: true,
        message: 'Connected — Greenweb account token verified.',
      });
    });

    it('reports an actionable message on failure, never the raw payload', async () => {
      pinnedFetchMock.mockResolvedValue({
        status: 'error',
        error_msg: 'Invalid token: super-secret-key',
      });

      const result = await gateway.testConnection({
        gateway: 'greenweb',
        apiKey: 'super-secret-key',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication rejected — check the account token.');
      expect(result.message).not.toContain('super-secret-key');
    });

    it('returns success: false instead of throwing on a network error', async () => {
      pinnedFetchMock.mockRejectedValue(new Error('network down'));

      const result = await gateway.testConnection({ gateway: 'greenweb', apiKey: 'key-1' });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the Greenweb API.');
    });

    it('routes through the pinned dispatcher rather than a bare fetch', async () => {
      pinnedFetchMock.mockResolvedValue({ status: 'success', balance: 100 });

      await gateway.testConnection({ gateway: 'greenweb', apiKey: 'key-1' });

      expect(pinnedFetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
