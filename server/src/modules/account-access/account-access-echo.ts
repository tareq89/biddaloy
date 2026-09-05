import type { ConfigService } from '@nestjs/config';

/**
 * D6's test-observability flag: with `ACCOUNT_ACCESS_ECHO_SECRETS=true`,
 * the request-style endpoints (invite, resend, forgot-password, otp/request,
 * contact-change request) include `debug: { token?, otp? }` in their
 * response — so e2e specs and Playwright can read the real secret without
 * scraping the delivery provider's logs. Never enabled in production; see
 * `assertSecretEchoAllowed`.
 */
export function isSecretEchoEnabled(config: Pick<ConfigService, 'get'>): boolean {
  return config.get<string>('ACCOUNT_ACCESS_ECHO_SECRETS') === 'true';
}

/**
 * Refuses to boot if the echo flag is set in production — same "loud
 * failure beats a silent gap" posture as `buildDatabaseSsl` and
 * `ENABLE_API_DOCS`'s Basic Auth requirement in main.ts.
 */
export function assertSecretEchoAllowed(
  nodeEnv: string | undefined,
  echoSecretsEnv: string | undefined,
): void {
  if (nodeEnv === 'production' && echoSecretsEnv === 'true') {
    throw new Error(
      'ACCOUNT_ACCESS_ECHO_SECRETS must never be "true" in production — refusing to boot with ' +
        'invitation/OTP/reset secrets echoed back in API responses.',
    );
  }
}
