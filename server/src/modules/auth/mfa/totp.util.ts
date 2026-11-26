import {
  generateSecret as otplibGenerateSecret,
  generateURI,
  verifySync,
  NobleCryptoPlugin,
} from 'otplib';

const STEP_SECONDS = 30;
const crypto = new NobleCryptoPlugin();

// Shared RFC 6238 defaults so no caller can drift (D20).
const TOTP_OPTIONS = {
  digits: 6,
  period: STEP_SECONDS,
  epochTolerance: STEP_SECONDS, // equivalent to window: 1 (±1 step)
  crypto,
} as const;

export function generateSecret(): string {
  // Defaults to 20 random bytes (Base32-encoded) in v13
  return otplibGenerateSecret({ length: 20, crypto });
}

/** `Biddaloy Cockpit`, plus the env name outside production so entries do not mix in the app. */
export function issuerName(envName = process.env.ENV_NAME, nodeEnv = process.env.NODE_ENV): string {
  const base = 'Biddaloy Cockpit';
  if (nodeEnv === 'production' && (!envName || envName === 'production')) return base;
  return `${base} (${envName ?? nodeEnv ?? 'dev'})`;
}

export function otpauthUri(secret: string, label: string, issuer: string): string {
  return generateURI({
    issuer,
    label,
    secret,
    digits: TOTP_OPTIONS.digits,
    period: TOTP_OPTIONS.period,
  });
}

/** Step number the code matches (within window 1), or null. Callers store it to block replay. */
export function matchStep(secret: string, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;

  const result = verifySync({
    ...TOTP_OPTIONS,
    secret,
    token: code,
    epoch: Math.floor(nowMs / 1000), // v13 expects Unix seconds
  });

  if (!result.valid || result.delta === undefined) return null;
  return Math.floor(nowMs / 1000 / STEP_SECONDS) + result.delta;
}
