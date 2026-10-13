import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { validate } from '../config/env.validation';
import { assertSecretEchoAllowed } from '../modules/account-access/account-access-echo';
import { buildDatabaseSsl } from '../db-ssl';
import {
  buildEncryptionKey,
  buildPreviousEncryptionKeys,
} from '../modules/schools/settings/encryption-key';
import { resolveAppBaseUrl } from '../modules/account-access/app-base-url.util';
import { resolvePublicAppUrl } from '../modules/invoices/public-app-url.util';

/**
 * `yarn config:check` — runs the boot-time config checks without starting
 * Nest: env.validation.ts, the ACCOUNT_ACCESS_ECHO_SECRETS guard (main.ts),
 * DB_SSL (db-ssl.ts), the SETTINGS_ENCRYPTION_KEY(_PREVIOUS) shape (encryption-key.ts),
 * and the APP_BASE_URL / PUBLIC_APP_URL https checks the link builders run.
 * Every failing check is listed. Error text names variables only, never
 * their values.
 */
export function runConfigCheck(env: Record<string, unknown>): { ok: boolean; output: string } {
  const get = (key: string) => env[key] as string | undefined;
  const config = { get } as unknown as ConfigService;
  const checks = [
    () => validate(env),
    () => assertSecretEchoAllowed(get('NODE_ENV'), get('ACCOUNT_ACCESS_ECHO_SECRETS')),
    () => buildDatabaseSsl(get('NODE_ENV'), get('DB_SSL'), get('DB_SSL_REJECT_UNAUTHORIZED')),
    // An unset key or URL is already reported by validate(); these add the shape checks.
    () =>
      get('SETTINGS_ENCRYPTION_KEY') &&
      buildEncryptionKey(get('NODE_ENV'), get('SETTINGS_ENCRYPTION_KEY')),
    () => buildPreviousEncryptionKeys(get('SETTINGS_ENCRYPTION_KEY_PREVIOUS')),
    () => get('APP_BASE_URL') && resolveAppBaseUrl(config),
    () => get('PUBLIC_APP_URL') && resolvePublicAppUrl(config),
  ];
  const errors = checks.flatMap((check) => {
    try {
      check();
      return [];
    } catch (err) {
      return [err instanceof Error ? err.message : String(err)];
    }
  });
  return errors.length === 0
    ? { ok: true, output: 'config ok' }
    : { ok: false, output: errors.join('\n') };
}

/** The deploy container always runs as production, so the CLI judges it that way
 * whatever NODE_ENV the host `.env` says (a dev `.env` must not print a false "config ok"). */
export function runProductionConfigCheck(env: Record<string, unknown>) {
  return runConfigCheck({ ...env, NODE_ENV: 'production' });
}

if (require.main === module) {
  config({ path: resolve(__dirname, '..', '..', '..', '.env') });
  const { ok, output } = runProductionConfigCheck(process.env);
  (ok ? console.log : console.error)(output);
  process.exit(ok ? 0 : 1);
}
