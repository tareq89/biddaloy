import { ConfigService } from '@nestjs/config';

const DEFAULT_APP_BASE_URL = 'http://localhost:5174';

/**
 * Shared by `InvitationService` and `RecoveryService` — both append a
 * secret-bearing token to this base to build an activation/reset link
 * (`${appBaseUrl}/activate?token=...`, `.../reset-password?token=...`).
 * A `local dev over plain HTTP is fine, but a production deployment must
 * both set this explicitly and serve it over HTTPS, or the token travels
 * in the clear to whatever network sits between the recipient and this
 * origin (email/SMS gateways, corporate proxies, etc).
 */
export function resolveAppBaseUrl(config: ConfigService): string {
  const configured = config.get<string>('APP_BASE_URL');
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (!configured) {
    if (isProduction) {
      throw new Error('APP_BASE_URL must be set in production to build invitation/reset links.');
    }
    return DEFAULT_APP_BASE_URL;
  }

  if (!isProduction) {
    return configured;
  }

  // `new URL()` rejects malformed input outright — a value like
  // `https://` (no host) would otherwise pass a plain `startsWith('https://')`
  // check and produce `https:///reset-password?token=...`, which the URL
  // spec resolves to hostname "reset-password", sending the token to the
  // wrong host. Credentials/query/fragment are rejected too: none of them
  // belong in a base URL, and a query string here would collide with the
  // `?token=` this gets appended with.
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('APP_BASE_URL must be a valid absolute URL in production.');
  }

  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'APP_BASE_URL must be an HTTPS URL with a hostname and no credentials, query, or ' +
        'fragment in production — invitation/reset links carry a secret token and must not ' +
        'be sent over plain HTTP or to an unintended host.',
    );
  }

  return configured;
}
