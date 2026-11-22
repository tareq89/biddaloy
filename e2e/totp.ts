import { generateSync } from 'otplib';
import { DEV_COCKPIT_TOTP_SECRET } from '@biddaloy/shared';

// Same options as server/src/modules/auth/mfa/totp.util.ts: 6 digits, 30 s step, SHA-1.
const STEP_MS = 30_000;

/**
 * The current TOTP code. A code is single-use per 30 s step (the server stores `last_step`), so a
 * test that signs in twice in a row must wait `nextStepIn()` ms before asking for the second code.
 */
export function totpNow(secret = DEV_COCKPIT_TOTP_SECRET, nowMs = Date.now()): string {
  return generateSync({
    secret,
    digits: 6,
    period: 30,
    epoch: Math.floor(nowMs / 1000),
  });
}

/** Milliseconds until the next 30 s step begins. */
export function nextStepIn(nowMs = Date.now()): number {
  return STEP_MS - (nowMs % STEP_MS);
}
