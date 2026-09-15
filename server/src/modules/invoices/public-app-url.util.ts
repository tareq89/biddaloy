import { ConfigService } from '@nestjs/config';

const DEFAULT_PUBLIC_APP_URL = 'http://localhost:5174';

/**
 * [#666] Base URL a share link opens in: `POST /invoices/:id/share`
 * returns `${resolvePublicAppUrl(...)}/i/<token>`. Mirrors
 * `account-access/app-base-url.util.ts`'s `resolveAppBaseUrl` — same
 * "required, HTTPS-only in production; a fixed localhost default
 * otherwise" shape, kept as its own function because this URL fronts a
 * different (guardian-facing) app than `APP_BASE_URL`'s staff SPA, even
 * though today, absent a separate client-student app in this repo, both
 * default to the same origin.
 */
export function resolvePublicAppUrl(config: ConfigService): string {
  const configured = config.get<string>('PUBLIC_APP_URL');
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (!configured) {
    if (isProduction) {
      throw new Error('PUBLIC_APP_URL must be set in production to build invoice share links.');
    }
    return DEFAULT_PUBLIC_APP_URL;
  }

  if (!isProduction) {
    return configured;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('PUBLIC_APP_URL must be a valid absolute URL in production.');
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
      'PUBLIC_APP_URL must be an HTTPS URL with a hostname and no credentials, query, or fragment in production.',
    );
  }

  return configured;
}
