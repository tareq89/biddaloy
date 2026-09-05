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

  if (isProduction && !configured.startsWith('https://')) {
    throw new Error(
      'APP_BASE_URL must be an HTTPS URL in production — invitation/reset links carry a secret ' +
        'token and must not be sent over plain HTTP.',
    );
  }

  return configured;
}
