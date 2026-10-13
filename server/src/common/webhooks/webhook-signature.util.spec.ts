import { describe, it, expect } from 'vitest';
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from './webhook-signature.util';

const secret = 'whsec_test';
const timestamp = '1760000000';
const body = Buffer.from('{"event":"ping"}');
const nowMs = Number(timestamp) * 1000;
const sig = signWebhookPayload(body, timestamp, secret);
const check = (over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
  verifyWebhookSignature({ rawBody: body, signature: sig, timestamp, secret, nowMs, ...over });

describe('webhook signature util', () => {
  it('accepts a valid signature', () => expect(check()).toBe(true));

  it('accepts exactly +-300 s and rejects 301 s (replay window)', () => {
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
    expect(check({ nowMs: nowMs + 300_000 })).toBe(true);
    expect(check({ nowMs: nowMs - 300_000 })).toBe(true);
    expect(check({ nowMs: nowMs + 301_000 })).toBe(false);
    expect(check({ nowMs: nowMs - 301_000 })).toBe(false);
  });

  it('returns false, never throws, on bad input', () => {
    expect(check({ signature: 'z'.repeat(64) })).toBe(false);
    expect(check({ signature: sig.slice(0, 63) })).toBe(false);
    expect(check({ signature: '' })).toBe(false);
    expect(check({ timestamp: '12a' })).toBe(false);
  });

  it('rejects a tampered body and a wrong secret', () => {
    expect(check({ rawBody: Buffer.from('{"event":"pong"}') })).toBe(false);
    expect(check({ secret: 'other' })).toBe(false);
  });

  it('accepts uppercase hex', () => expect(check({ signature: sig.toUpperCase() })).toBe(true));

  it('matches the worked example in docs/architecture/10-third-party-services.md', () => {
    expect(sig).toBe('7b3dfb12b416238df73d3eb92d1702951e3ebe69a71967d039b03ccc93c8d291');
  });
});
