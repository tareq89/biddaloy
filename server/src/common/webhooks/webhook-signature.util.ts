import { createHmac, timingSafeEqual } from 'node:crypto';

// ponytail: no idempotency table (keyed by provider event id), no nonce store,
// no provider adapters. The first gateway ticket adds the table with its real
// event-id format; the timestamp window plus that key covers replay.

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as lowercase hex. */
export function signWebhookPayload(rawBody: Buffer, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/**
 * True only when `signature` matches the body and `timestamp` is inside the
 * replay window (+-tolerance). Constant-time compare; false (never a throw) on
 * a bad/short signature, a non-integer timestamp, or an empty / non-string secret. Provider adapters map their
 * own header format (e.g. Stripe's `t=...,v1=...`) onto these inputs. The
 * caller throws, usually a 401 with no detail.
 */
export function verifyWebhookSignature(input: {
  rawBody: Buffer;
  signature: string;
  timestamp: string;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret } = input;
  // An unset env var must never verify: anyone can sign with an empty key.
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) return false;
  const now = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(now - Number(timestamp)) > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) {
    return false;
  }
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signWebhookPayload(rawBody, timestamp, secret), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature.toLowerCase(), 'hex'));
}
