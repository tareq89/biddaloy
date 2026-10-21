import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config, parse } from 'dotenv';
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
import { requireDocsCredentials } from '../swagger';

/**
 * `yarn config:check` — runs the boot-time config checks without starting
 * Nest: env.validation.ts, the ACCOUNT_ACCESS_ECHO_SECRETS guard (main.ts),
 * DB_SSL (db-ssl.ts), the SETTINGS_ENCRYPTION_KEY(_PREVIOUS) shape (encryption-key.ts),
 * the APP_BASE_URL / PUBLIC_APP_URL https checks the link builders run, and
 * the ENABLE_API_DOCS credentials check (main.ts).
 * `--env staging` adds the no-real-provider rules (runStagingConfigCheck).
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
    () =>
      get('NODE_ENV') === 'production' &&
      get('ENABLE_API_DOCS') === 'true' &&
      requireDocsCredentials(get('API_DOCS_USER'), get('API_DOCS_PASSWORD')),
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

/** Cloudflare's published always-pass Turnstile secret: staging sign-ups work, no real key is stored. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

// Every variable that can reach a real SMS / WhatsApp / email / push provider (.env.example).
const PROVIDER_VAR = /^(SMS_|MIMSMS_|GREENWEB_|WHATSAPP_|SMTP_|VAPID_|PLATFORM_SMS_)/;

/**
 * What deploy/stack.yml builds for `app` from the host `.env` rather than passing through:
 * the database URL. Everything else the check judges is the `.env` itself.
 */
export function composeAppEnv(env: Record<string, unknown>): Record<string, unknown> {
  const str = (k: string) => String(env[k] ?? '');
  return {
    DATABASE_URL: `postgres://${str('POSTGRES_USER')}:${str('POSTGRES_PASSWORD')}@db:5432/${str('POSTGRES_DB')}`,
    ...env,
  };
}

/**
 * `--env staging` (D25): the production checks on the env the staging container gets, plus
 * staging must run the demo school on its own database and bucket and must not be able to
 * message anyone. deploy/stack.yml passes these straight from the `.env`, so the `.env`
 * itself is judged. Names variables only, never values.
 */
export function runStagingConfigCheck(env: Record<string, unknown>): {
  ok: boolean;
  output: string;
} {
  const prod = runProductionConfigCheck(composeAppEnv(env));
  const set = (k: string) => typeof env[k] === 'string' && env[k] !== '';
  const errors = [
    ...Object.keys(env)
      .filter((k) => (PROVIDER_VAR.test(k) || k === 'PLATFORM_ALERT_PHONES') && set(k))
      .map((k) => `${k} must be empty on staging (no real SMS / WhatsApp / email / push provider)`),
    ...(env.POSTGRES_DB === 'biddaloy_staging' ? [] : ['POSTGRES_DB must be biddaloy_staging']),
    ...(env.S3_BUCKET === 'biddaloy-staging' ? [] : ['S3_BUCKET must be biddaloy-staging']),
    ...(env.DEMO_MODE === 'true' ? [] : ['DEMO_MODE must be true on staging']),
    ...(env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET
      ? []
      : ["TURNSTILE_SECRET_KEY must be Cloudflare's always-pass test secret on staging"]),
  ];
  const all = [...(prod.ok ? [] : [prod.output]), ...errors];
  return all.length === 0
    ? { ok: true, output: 'config ok' }
    : { ok: false, output: all.join('\n') };
}

/**
 * With `--file`, the file's contents are the whole env: the controller's own process.env
 * (a shell with SMTP_* or a prod secret exported) must not leak into the verdict.
 */
export function loadEnvFile(file: string | undefined, processEnv: Record<string, unknown>) {
  return file ? parse(readFileSync(file)) : processEnv;
}

if (require.main === module) {
  // `--file <path>` reads that env file instead of the repo-root .env (deploy.yml pipes the
  // decrypted secrets in via /dev/stdin, so staging is checked before anything is written).
  const arg = (name: string) => {
    const at = process.argv.indexOf(name);
    return at > -1 ? process.argv[at + 1] : undefined;
  };
  const file = arg('--file');
  if (!file) config({ path: resolve(__dirname, '..', '..', '..', '.env') });
  const target = arg('--env') ?? 'prod';
  if (target !== 'prod' && target !== 'staging') {
    console.error('Usage: config:check [--env prod|staging]');
    process.exit(2);
  }
  const { ok, output } = (target === 'staging' ? runStagingConfigCheck : runProductionConfigCheck)(
    loadEnvFile(file, process.env),
  );
  (ok ? console.log : console.error)(output);
  process.exit(ok ? 0 : 1);
}
