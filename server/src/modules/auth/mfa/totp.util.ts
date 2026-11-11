import { authenticator } from 'otplib';

const STEP_SECONDS = 30;

// All TOTP parameters live here so no caller can drift (D20).
// RFC 6238 defaults that every authenticator app supports.
const totp = authenticator.clone({
  digits: 6,
  step: STEP_SECONDS,
  window: 1,
});

export function generateSecret(): string {
  return totp.generateSecret(20);
}

/** `Biddaloy Cockpit`, plus the env name outside production so entries do not mix in the app. */
export function issuerName(envName = process.env.ENV_NAME, nodeEnv = process.env.NODE_ENV): string {
  const base = 'Biddaloy Cockpit';
  if (nodeEnv === 'production' && (!envName || envName === 'production')) return base;
  return `${base} (${envName ?? nodeEnv ?? 'dev'})`;
}

export function otpauthUri(secret: string, label: string, issuer: string): string {
  return totp.keyuri(label, issuer, secret);
}

/** Step number the code matches (within window 1), or null. Callers store it to block replay. */
export function matchStep(secret: string, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp.clone({ epoch: nowMs }).checkDelta(code, secret);
  if (delta === null || delta === undefined) return null;
  return Math.floor(nowMs / 1000 / STEP_SECONDS) + delta;
}
