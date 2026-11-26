import { generateSecret, generateSync } from 'otplib';

/**
 * TOTP helpers for specs, matching server/src/modules/auth/mfa/totp.util.ts's
 * parameters (6 digits, 30 s step, SHA-1). otplib v13 dropped the
 * `authenticator` singleton and `clone()`; these wrap the functional API.
 */

/** The current code for `secret` at `nowMs` (defaults to now). */
export function totpNow(secret: string, nowMs = Date.now()): string {
  return generateSync({ secret, digits: 6, period: 30, epoch: Math.floor(nowMs / 1000) });
}

/** A random Base32 secret, same shape the service's own `generateSecret` mints. */
export function totpSecret(): string {
  return generateSecret({ length: 20 });
}
