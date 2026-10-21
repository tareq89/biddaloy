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
 * `--env prod|staging|demo` adds that stack's rules (runStackConfigCheck): required vars, ENV_NAME,
 * no prod database or bucket outside prod, DEMO_MODE, the Turnstile key pair. From the app image:
 * `node server/dist/scripts/config-check.js --env <e> --file /dev/stdin`.
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
// Also refused on staging: real alert phones and social sign-in (real accounts) credentials.
const EXTRA_REFUSED = /^(PLATFORM_ALERT_PHONES|GOOGLE_OAUTH_|FACEBOOK_OAUTH_)/;
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

export type Stack = 'prod' | 'staging' | 'demo';

/**
 * What deploy/stack.yml hands the app that the host `.env` does not hold: the database URL is
 * built from POSTGRES_*, and the bucket falls back to the prod default. The check judges the
 * env the container really gets.
 */
export function composeAppEnv(env: Record<string, unknown>): Record<string, unknown> {
  const str = (k: string) => String(env[k] ?? '');
  return {
    ...env,
    // Same defaults and fixed values as the x-app block of deploy/stack.yml.
    S3_BUCKET: str('S3_BUCKET') || 'biddaloy',
    SENTRY_TRACES_SAMPLE_RATE: str('SENTRY_TRACES_SAMPLE_RATE') || '0.1',
    DB_SSL: 'true',
    // After ...env: compose builds it, a DATABASE_URL in the host file is never used.
    DATABASE_URL: `postgres://${str('POSTGRES_USER')}:${str('POSTGRES_PASSWORD')}@db:5432/${str('POSTGRES_DB')}?sslmode=require`,
  };
}

// The `:?` variables of deploy/stack.yml for every stack, plus what each stack adds
// (a spec keeps the common part equal to the compose file).
export const COMMON_REQUIRED = [
  'ENV_NAME',
  'APP_VERSION',
  'POSTGRES_USER',
  'POSTGRES_DB',
  'POSTGRES_PASSWORD',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const EXTRA_REQUIRED: Record<Stack, string[]> = {
  prod: ['BACKUP_AGE_PUBLIC_KEY'],
  staging: ['STAGING_PASSWORD'],
  demo: ['DEMO_PASSWORD'],
};

/**
 * `--env prod|staging|demo`: the production checks on the env the container gets, plus the
 * rules of that stack. Provider variables are judged on the host file itself. Names variables
 * only, never values.
 */
export function runStackConfigCheck(
  stack: Stack,
  env: Record<string, unknown>,
): { ok: boolean; output: string } {
  const base = runProductionConfigCheck(composeAppEnv(env));
  const val = (k: string) => (typeof env[k] === 'string' ? (env[k] as string) : '');
  const set = (k: string) => val(k) !== '';
  const errors: string[] = [
    ...[...COMMON_REQUIRED, ...EXTRA_REQUIRED[stack]]
      .filter((k) => !set(k))
      .map((k) => `${k} must be set`),
    ...(set('ENV_NAME') && val('ENV_NAME') !== stack ? [`ENV_NAME must be ${stack}`] : []),
    // Both Turnstile keys or neither: a lone key breaks or silently disables the public forms.
    ...(set('TURNSTILE_SITE_KEY') !== set('TURNSTILE_SECRET_KEY')
      ? ['TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together']
      : []),
  ];
  if (stack === 'prod' && val('DEMO_MODE') === 'true') {
    errors.push('DEMO_MODE must not be true on prod');
  }
  if (stack !== 'prod') {
    // A non-prod stack must not touch a prod resource: it has its own database and bucket.
    if (set('POSTGRES_DB') && val('POSTGRES_DB') !== `biddaloy_${stack}`) {
      errors.push(`POSTGRES_DB must be biddaloy_${stack}`);
    }
    if (val('S3_BUCKET') !== `biddaloy-${stack}`) {
      errors.push(`S3_BUCKET must be biddaloy-${stack} (never the prod bucket)`);
    }
    // The jobs and replica profiles of prod must not start on another stack.
    const profiles = val('COMPOSE_PROFILES')
      .split(',')
      .map((p) => p.trim());
    for (const p of ['backup', 'replica']) {
      if (profiles.includes(p)) errors.push(`COMPOSE_PROFILES must not contain ${p} on ${stack}`);
    }
    // No offsite backup target on a non-prod stack (it could overwrite prod's backups).
    if (stack === 'demo') {
      errors.push(
        ...Object.keys(env)
          .filter((k) => k.startsWith('BACKUP_S3_') && set(k))
          .map((k) => `${k} must be empty on demo`),
      );
    }
  }
  if (stack === 'staging') {
    // Prod data is refused under demo mode (demo-boot-check.ts), so staging runs with it off.
    if (val('DEMO_MODE') !== 'false') errors.push('DEMO_MODE must be false on staging');
    if (set('STAGING_PASSWORD') && val('STAGING_PASSWORD').length < 12) {
      errors.push('STAGING_PASSWORD must be at least 12 characters');
    }
    errors.push(
      ...Object.keys(env)
        .filter((k) => (PROVIDER_VAR.test(k) || EXTRA_REFUSED.test(k)) && set(k))
        .map(
          (k) => `${k} must be empty on staging (no real SMS / WhatsApp / email / push provider)`,
        ),
    );
    if (val('TURNSTILE_SITE_KEY') !== TURNSTILE_TEST_SITE_KEY) {
      errors.push("TURNSTILE_SITE_KEY must be Cloudflare's always-pass test key on staging");
    }
    if (set('TURNSTILE_SECRET_KEY') && val('TURNSTILE_SECRET_KEY') !== TURNSTILE_TEST_SECRET) {
      errors.push("TURNSTILE_SECRET_KEY must be Cloudflare's always-pass test secret on staging");
    }
  }
  if (stack === 'demo' && val('DEMO_MODE') !== 'true')
    errors.push('DEMO_MODE must be true on demo');
  const all = [...(base.ok ? [] : [base.output]), ...errors];
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
  if (target !== 'prod' && target !== 'staging' && target !== 'demo') {
    console.error('Usage: config:check [--env prod|staging|demo] [--file <path>]');
    process.exit(2);
  }
  const { ok, output } = runStackConfigCheck(target, loadEnvFile(file, process.env));
  (ok ? console.log : console.error)(output);
  process.exit(ok ? 0 : 1);
}
