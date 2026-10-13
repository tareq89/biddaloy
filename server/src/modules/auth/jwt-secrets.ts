import type { JwtService, JwtVerifyOptions } from '@nestjs/jwt';

/** Anything with a string `get` — ConfigService, or `{ get: k => process.env[k] }`. */
export type SecretSource = { get(key: string): string | undefined };

export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_ISSUER = 'biddaloy';
export const ACCESS_TOKEN_AUDIENCE = 'biddaloy:access';
/** Step-up approval tokens (X-Approval-Token): never interchangeable with an access token. */
export const APPROVAL_TOKEN_AUDIENCE = 'biddaloy:approval';

/** Current secret first; JWT_SECRET_PREVIOUS (verify-only, D21) second when set and non-empty. */
export function jwtVerifySecrets(config: SecretSource): string[] {
  const current = config.get('JWT_SECRET');
  if (!current) throw new Error('JWT_SECRET is not configured');
  const previous = config.get('JWT_SECRET_PREVIOUS');
  return previous ? [current, previous] : [current];
}

/** Tries each secret in order; rethrows the LAST error when none verifies. */
export async function verifyWithRotation<T extends object>(
  jwt: JwtService,
  token: string,
  config: SecretSource,
  options: JwtVerifyOptions = {},
): Promise<T> {
  const secrets = jwtVerifySecrets(config);
  let lastError: unknown;
  for (const secret of secrets) {
    try {
      return await jwt.verifyAsync<T>(token, { ...options, secret });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
