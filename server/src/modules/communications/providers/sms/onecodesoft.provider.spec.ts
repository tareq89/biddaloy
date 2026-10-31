import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OnecodesoftProvider } from './onecodesoft.provider';
import {
  assertSafeHttpDestination,
  DestinationBlockedError,
} from '../shared/outbound-destination-guard';
import { fetchPinnedJson } from '../shared/pinned-http';

// Destination-class validation and connection pinning have their own specs;
// stub both so these tests only assert gateway-level behaviour.
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
vi.mock('../shared/pinned-http', () => ({ fetchPinnedJson: vi.fn() }));

const config = { apiKey: 'key-1', senderId: 'School', apiUrl: 'https://sms.example.com/api/' };
const sentResponse = {
  status: 'success',
  data: { results: [{ to: '8801712345678', status: 'sent', message_id: 'm-1', sms_count: 2 }] },
};

describe('OnecodesoftProvider', () => {
  let provider: OnecodesoftProvider;
  const pinned = vi.mocked(fetchPinnedJson);

  beforeEach(() => {
    provider = new OnecodesoftProvider();
    pinned.mockReset();
    vi.mocked(assertSafeHttpDestination).mockClear();
  });

  describe('descriptor', () => {
    it('declares status and balance, a required apiUrl and an optional senderId', () => {
      const d = provider.descriptor;
      expect(d.name).toBe('onecodesoft');
      expect(d.capabilities).toEqual(['status', 'balance']);
      expect(d.fields.find((f) => f.key === 'apiUrl')?.required).toBe(true);
      expect(d.fields.find((f) => f.key === 'senderId')?.required).toBe(false);
      expect(d.fields.find((f) => f.key === 'apiKey')?.kind).toBe('secret');
      expect(provider.envPrefix).toBe('ONECODESOFT');
    });
  });

  describe('send request shape', () => {
    it('POSTs JSON with a Bearer header, normalised phone and senderid', async () => {
      pinned.mockResolvedValue(sentResponse);
      await provider.send({ to: '01712345678', body: 'hi' }, config);

      expect(assertSafeHttpDestination).toHaveBeenCalledWith('https://sms.example.com/api/');
      const [, url, init] = pinned.mock.calls[0]!;
      expect(url).toBe('https://sms.example.com/api/v3/send-sms');
      expect(init!.method).toBe('POST');
      expect(init!.headers).toMatchObject({
        Authorization: 'Bearer key-1',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init!.body as string)).toEqual({
        number: '8801712345678',
        message: 'hi',
        senderid: 'School',
      });
    });

    it('omits senderid when it is empty or missing', async () => {
      pinned.mockResolvedValue(sentResponse);
      await provider.send({ to: '01712345678', body: 'hi' }, { ...config, senderId: '' });
      await provider.send({ to: '01712345678', body: 'hi' }, { ...config, senderId: undefined });
      for (const call of pinned.mock.calls) {
        expect(JSON.parse(call[2]!.body as string)).not.toHaveProperty('senderid');
      }
    });

    it('passes a unicode body through untouched', async () => {
      pinned.mockResolvedValue(sentResponse);
      await provider.send({ to: '01712345678', body: 'ফি জমা দিন' }, config);
      expect(JSON.parse(pinned.mock.calls[0]![2]!.body as string).message).toBe('ফি জমা দিন');
    });
  });

  describe('send outcome mapping (D5)', () => {
    it('sent -> ACCEPTED with message id and vendor sms_count', async () => {
      pinned.mockResolvedValue(sentResponse);
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toEqual({
        success: true,
        providerMessageId: 'm-1',
        raw: sentResponse,
        segments: 2,
        outcome: 'ACCEPTED',
      });
    });

    it('falls back to the local segment count when sms_count is absent', async () => {
      pinned.mockResolvedValue({
        status: 'success',
        data: { results: [{ status: 'sent', message_id: 'm-2' }] },
      });
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r.segments).toBe(1);
    });

    const expectRecipientRejected = async (status: string) => {
      pinned.mockResolvedValue({ status: 'success', data: { results: [{ status }] } });
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        success: false,
        outcome: 'REJECTED',
        retryable: false,
        error: 'OneCodeSoft rejected the message.',
      });
    };

    it('per-recipient failed -> REJECTED', () => expectRecipientRejected('failed'));
    it('per-recipient blocked -> REJECTED', () => expectRecipientRejected('blocked'));
    it('per-recipient spam -> REJECTED', () => expectRecipientRejected('spam'));

    it('"Sent" in any letter case is still ACCEPTED', async () => {
      pinned.mockResolvedValue({
        status: 'success',
        data: { results: [{ status: 'SENT', message_id: 'm-3' }] },
      });
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r.outcome).toBe('ACCEPTED');
    });

    it('a 401 body with no status field ("Unauthenticated.") -> REJECTED with the key sentence', async () => {
      pinned.mockResolvedValue({ message: 'Unauthenticated.' });
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        outcome: 'REJECTED',
        retryable: false,
        error: 'OneCodeSoft rejected the API key.',
      });
    });

    it('missing apiUrl -> REJECTED, not retryable, nothing fetched', async () => {
      const r = await provider.send({ to: '01712345678', body: 'hi' }, { ...config, apiUrl: '' });
      expect(r).toMatchObject({
        outcome: 'REJECTED',
        retryable: false,
        error: 'OneCodeSoft API address is not set.',
      });
      expect(pinned).not.toHaveBeenCalled();
    });

    it('status error -> REJECTED; vendor text only in raw, never in error', async () => {
      const raw = { status: 'error', message: 'Insufficient balance for 01712345678' };
      pinned.mockResolvedValue(raw);
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({ outcome: 'REJECTED', retryable: false, raw });
      expect(r.error).toBe('OneCodeSoft rejected the message.');
      expect(r.error).not.toContain('01712345678');
    });

    it('401-style unauthorized body -> REJECTED with the API key sentence', async () => {
      pinned.mockResolvedValue({ status: 'error', message: 'Unauthorized' });
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        outcome: 'REJECTED',
        retryable: false,
        error: 'OneCodeSoft rejected the API key.',
      });
    });

    it('unparsable body (fetch throws) -> AMBIGUOUS, never throws, no raw error text', async () => {
      pinned.mockRejectedValue(new Error('Unexpected token < in JSON, key-1'));
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({ success: false, outcome: 'AMBIGUOUS' });
      expect(r.retryable).toBeUndefined();
      expect(r.error).toBe('OneCodeSoft did not give a usable answer.');
    });

    it('timeout -> AMBIGUOUS', async () => {
      pinned.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r.outcome).toBe('AMBIGUOUS');
    });

    it('5xx-style body with no recognisable shape -> AMBIGUOUS', async () => {
      pinned.mockResolvedValue({ message: 'Bad gateway' });
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({ success: false, outcome: 'AMBIGUOUS' });
    });

    it('success with no results -> AMBIGUOUS (the SMS may have gone out)', async () => {
      pinned.mockResolvedValue({ status: 'success', data: { results: [] } });
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r.outcome).toBe('AMBIGUOUS');
    });

    it('blocked destination -> REJECTED, not retryable, nothing fetched', async () => {
      vi.mocked(assertSafeHttpDestination).mockRejectedValueOnce(
        new DestinationBlockedError('https://10.0.0.1/api is private'),
      );
      const r = await provider.send({ to: '01712345678', body: 'hi' }, config);
      expect(r).toMatchObject({
        outcome: 'REJECTED',
        retryable: false,
        // Fixed sentence: the guard's text (which can hold the raw URL) never reaches `error`.
        error: 'OneCodeSoft API address is not allowed.',
      });
      expect(pinned).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('parses balance and estimate_sms and sends the Bearer header', async () => {
      pinned.mockResolvedValue({
        status: 'success',
        data: { balance: '120.50', estimate_sms: 400 },
      });
      await expect(provider.getBalance(config)).resolves.toEqual({
        amount: 120.5,
        estimateSms: 400,
      });
      const [, url, init] = pinned.mock.calls[0]!;
      expect(url).toBe('https://sms.example.com/api/v3/balance');
      expect(init!.headers).toMatchObject({ Authorization: 'Bearer key-1' });
    });

    it('a missing or empty balance throws instead of reading as 0', async () => {
      pinned.mockResolvedValue({ status: 'success', data: {} });
      await expect(provider.getBalance(config)).rejects.toThrow(
        'OneCodeSoft balance check failed.',
      );
      pinned.mockResolvedValue({ status: 'success', data: { balance: '' } });
      await expect(provider.getBalance(config)).rejects.toThrow(
        'OneCodeSoft balance check failed.',
      );
    });

    it('throws a fixed sentence on an error body (testConnection turns it into a failure)', async () => {
      pinned.mockResolvedValue({ status: 'error', message: 'secret detail' });
      await expect(provider.getBalance(config)).rejects.toThrow(
        'OneCodeSoft balance check failed.',
      );
    });

    // Review round 2, item 7: a refused key is told apart from "could not reach", in a fixed
    // sentence that never echoes the vendor's text or the key.
    it('a rejected key: testConnection says the key was rejected, nothing echoed', async () => {
      pinned.mockResolvedValue({ message: 'Unauthenticated. key-1' });
      const res = await provider.testConnection(config);
      expect(res).toEqual({
        success: false,
        message: 'OneCodeSoft rejected the API key — check it and try again.',
      });
      expect(res.message).not.toContain('key-1');
    });

    it('a network failure still says "could not reach"', async () => {
      pinned.mockRejectedValue(new Error('ECONNRESET https://sms.example.com/api?x=key-1'));
      await expect(provider.testConnection(config)).resolves.toEqual({
        success: false,
        message: 'Could not reach OneCodeSoft.',
      });
    });

    it('default testConnection says connected, without the balance amount', async () => {
      pinned.mockResolvedValue({ balance: 10 });
      await expect(provider.testConnection(config)).resolves.toEqual({
        success: true,
        message: 'Connected to OneCodeSoft.',
      });
    });
  });

  describe('getStatus', () => {
    // Documented shape: { status, message, data: { ErrorCode, ErrorDescription, Data: {...} } }.
    const call = (Data: Record<string, unknown> | undefined) => {
      pinned.mockResolvedValue({
        status: 'success',
        message: 'ok',
        data: { ErrorCode: 0, ErrorDescription: 'Success', Data },
      });
      return provider.getStatus('m 1', config);
    };

    it('still reads the older top-level Data shape', async () => {
      pinned.mockResolvedValue({ Data: { Status: 'Delivered', ErrorCode: '000' } });
      await expect(provider.getStatus('m1', config)).resolves.toEqual({
        status: 'DELIVERED',
        code: '000',
      });
    });

    it('an empty ErrorCode means no code, not FAILED', async () => {
      await expect(call({ Status: 'Queued', ErrorCode: '' })).resolves.toEqual({
        status: 'PENDING',
      });
      await expect(call({ Status: 'Queued', ErrorCode: null })).resolves.toEqual({
        status: 'PENDING',
      });
    });

    it('status error -> throws a fixed sentence', async () => {
      pinned.mockResolvedValue({ status: 'error', message: 'secret detail' });
      await expect(provider.getStatus('m1', config)).rejects.toThrow(
        'OneCodeSoft status check failed.',
      );
    });

    it('requests the encoded message id', async () => {
      await call({ Status: 'Delivered', ErrorCode: '000' });
      expect(pinned.mock.calls[0]![1]).toBe('https://sms.example.com/api/v3/status?message_id=m+1');
    });

    it('Delivered -> DELIVERED with the code', async () => {
      await expect(call({ Status: 'Delivered', ErrorCode: '000' })).resolves.toEqual({
        status: 'DELIVERED',
        code: '000',
      });
    });

    it('non-000 error code -> FAILED', async () => {
      await expect(call({ Status: 'Sent', ErrorCode: '105' })).resolves.toEqual({
        status: 'FAILED',
        code: '105',
      });
    });

    it('expired status -> FAILED', async () => {
      await expect(call({ Status: 'Expired', ErrorCode: '000' })).resolves.toMatchObject({
        status: 'FAILED',
      });
    });

    it('anything else (and a missing Data block) -> PENDING', async () => {
      await expect(call({ Status: 'Queued', ErrorCode: '000' })).resolves.toMatchObject({
        status: 'PENDING',
      });
      await expect(call(undefined)).resolves.toEqual({ status: 'PENDING' });
    });
  });

  // Review round 2, item 8 (CodeQL 45): the URL is built with `new URL`, not string joins.
  describe('API address handling', () => {
    it('joins the path whatever the slashes on the base', async () => {
      pinned.mockResolvedValue({ balance: 1 });
      for (const apiUrl of ['https://sms.example.com/api', 'https://sms.example.com/api//']) {
        pinned.mockClear();
        await provider.getBalance({ ...config, apiUrl });
        expect(pinned.mock.calls[0]![1]).toBe('https://sms.example.com/api/v3/balance');
      }
    });

    it('an address with a query or a fragment is refused before any request', async () => {
      for (const apiUrl of ['https://sms.example.com/api?x=1', 'https://sms.example.com/api#x']) {
        const res = await provider.send({ to: '01712345678', body: 'hi' }, { ...config, apiUrl });
        expect(res).toMatchObject({
          success: false,
          error: 'OneCodeSoft API address is not allowed.',
          outcome: 'REJECTED',
          retryable: false,
        });
        await expect(provider.getBalance({ ...config, apiUrl })).rejects.toBeInstanceOf(
          DestinationBlockedError,
        );
      }
      expect(pinned).not.toHaveBeenCalled();
    });
  });
});
