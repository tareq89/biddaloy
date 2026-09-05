import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * Shared secret-hashing helpers for every opaque, selector/validator-style
 * token in this codebase (refresh tokens, invitation/reset tokens). These
 * are 256-bit random secrets with no brute-forceable structure — unlike a
 * user-chosen password, a fast hash is the right tool here (see
 * refresh-token.service.ts's original comment for the full reasoning).
 *
 * Moved out of refresh-token.service.ts (12.1) so AuthTokenService can
 * reuse the exact same scheme instead of re-implementing it.
 */

export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

// Both sides are always 64-char sha256 hex digests once decoded, so the
// length check never rejects a well-formed comparison before
// timingSafeEqual runs — it only guards the (attacker-controlled) input
// from ever reaching timingSafeEqual with a mismatched length, which would
// throw rather than leak timing.
export function safeEqualHex(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
