import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'dotenv';
import {
  loadEnvFile,
  runConfigCheck,
  runProductionConfigCheck,
  runStagingConfigCheck,
  composeAppEnv,
  TURNSTILE_TEST_SECRET,
} from './config-check';

const repoRoot = join(__dirname, '..', '..', '..');

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:Zq8vR2mXw4Lp@db:5432/biddaloy',
  JWT_SECRET: 'k9Zr2Qv7Lm4Xw8Tb3Nc6Hy1Pd5Sf0Ja2Ug',
  // base64 of 32 bytes, as `randomBytes(32).toString('base64')` prints
  SETTINGS_ENCRYPTION_KEY: 'Fh3Jd9Kc2Vb7Nx5Mz1Qw8Er4Ty6Ui0OpLk3AseRt7Yu=',
  DB_SSL: 'true',
  APP_BASE_URL: 'https://app.school.org',
  PUBLIC_APP_URL: 'https://app.school.org',
};

describe('runConfigCheck', () => {
  it('passes a valid production env', () => {
    expect(runConfigCheck(valid)).toEqual({ ok: true, output: 'config ok' });
  });

  it('fails a placeholder env, naming the variable but not its value', () => {
    const secret = 'replace-me-replace-me-replace-me-123';
    const result = runConfigCheck({ ...valid, JWT_SECRET: secret });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('JWT_SECRET');
    expect(result.output).not.toContain(secret);
  });

  it('the CLI judges production even when NODE_ENV is development or unset', () => {
    const bad = { ...valid, JWT_SECRET: 'replace-me-replace-me-replace-me-123' };
    expect(runConfigCheck({ ...bad, NODE_ENV: 'development' }).ok).toBe(true); // rules skipped
    expect(runProductionConfigCheck({ ...bad, NODE_ENV: 'development' }).ok).toBe(false);
    const { NODE_ENV: _omit, ...unset } = bad;
    expect(runProductionConfigCheck(unset).ok).toBe(false);
  });

  it('fails POSTGRES_PASSWORD=change-me (compose builds the container DATABASE_URL from it)', () => {
    const result = runConfigCheck({ ...valid, POSTGRES_PASSWORD: 'change-me' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('POSTGRES_PASSWORD');
  });

  it('runs the boot checks outside env.validation and lists every failure', () => {
    const result = runConfigCheck({
      ...valid,
      DB_SSL: undefined,
      SETTINGS_ENCRYPTION_KEY: 'c2hvcnQta2V5LW9ubHktMTYtYnl0ZXM=',
      PUBLIC_APP_URL: 'http://app.school.org',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('DB_SSL must be "true"');
    expect(result.output).toContain('SETTINGS_ENCRYPTION_KEY must be base64 for exactly 32 bytes');
    expect(result.output).toContain('PUBLIC_APP_URL must be an HTTPS URL');
    expect(result.output).not.toContain('c2hvcnQta2V5');
  });

  it('fails when the secret-echo flag is on in production', () => {
    const result = runConfigCheck({ ...valid, ACCOUNT_ACCESS_ECHO_SECRETS: 'true' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('ACCOUNT_ACCESS_ECHO_SECRETS');
  });

  it('fails ENABLE_API_DOCS=true without both docs credentials, as boot does', () => {
    const docs = { ...valid, ENABLE_API_DOCS: 'true', API_DOCS_USER: 'docs' };
    const result = runConfigCheck(docs);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('API_DOCS_PASSWORD');
    expect(runConfigCheck({ ...docs, API_DOCS_PASSWORD: 'Zq8vR2mXw4Lp' }).ok).toBe(true);
  });
});

describe('runStagingConfigCheck', () => {
  // The staging .env exactly as an operator writes it: infra/secrets/staging.example.env with
  // its keys filled in, nothing else. Not `...valid`: that already holds DATABASE_URL and
  // DEMO_MODE, which compose (not the .env) provides, and hid that gap once.
  const fill: Record<string, string> = {
    APP_VERSION: '0'.repeat(40),
    APP_DOMAIN: 'staging.school.org',
    APP_BASE_URL: 'https://staging.school.org',
    CORS_ORIGINS: 'https://staging.school.org',
    PUBLIC_APP_URL: 'https://staging.school.org',
    POSTGRES_USER: 'app',
    POSTGRES_DB: 'biddaloy_staging',
    POSTGRES_PASSWORD: 'Zq8vR2mXw4Lp',
    JWT_SECRET: valid.JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY: valid.SETTINGS_ENCRYPTION_KEY,
    DB_SSL: 'true',
    HEALTH_TOKEN: 'h7Kp2Vx9Qm4Lr8Tz',
    S3_ACCESS_KEY_ID: 'k9Zr2Qv7',
    S3_SECRET_ACCESS_KEY: 'Lm4Xw8Tb3Nc6Hy1Pd5Sf',
    DEMO_PASSWORD: 'Demo-Public-2026',
    TLS_CERT_DIR: '/opt/biddaloy/certs',
  };
  const example = parse(readFileSync(join(repoRoot, 'infra/secrets/staging.example.env')));
  const staging: Record<string, string> = Object.fromEntries(
    Object.entries(example).map(([k, v]) => [k, v === '' ? (fill[k] ?? '') : v]),
  );

  it('composeAppEnv builds the database URL the way deploy/stack.yml does', () => {
    const stack = readFileSync(join(repoRoot, 'deploy/stack.yml'), 'utf8');
    expect(stack).toMatch(
      /^x-db-url: &db-url postgres:\/\/\$\{POSTGRES_USER[^}]*\}:\$\{POSTGRES_PASSWORD[^}]*\}@db:5432\/\$\{POSTGRES_DB[^}]*\}/m,
    );
    expect(
      composeAppEnv({
        POSTGRES_USER: 'u',
        POSTGRES_PASSWORD: 'p',
        POSTGRES_DB: 'biddaloy_staging',
      }),
    ).toMatchObject({ DATABASE_URL: 'postgres://u:p@db:5432/biddaloy_staging' });
  });

  // What really keeps a provider key out of the staging app is that deploy/stack.yml passes an
  // explicit list. A new key added there must be classified on purpose: either listed here as
  // not a provider, or refused by the staging check when set.
  it('every key deploy/stack.yml passes to app is a known non-provider or refused on staging', () => {
    const stack = readFileSync(join(repoRoot, 'deploy/stack.yml'), 'utf8');
    // x-s3 (merged in) through the end of x-app's environment block.
    const app = stack.slice(stack.indexOf('\nx-s3:'), stack.indexOf('\n  volumes:'));
    const keys = [...app.matchAll(/^ {2,4}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
    const notProvider = new Set([
      'NODE_ENV',
      'ENV_NAME',
      'NODE_EXTRA_CA_CERTS',
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'JWT_SECRET_PREVIOUS',
      'CORS_ORIGINS',
      'S3_ENDPOINT',
      'S3_ALLOW_INSECURE_HTTP',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_FORCE_PATH_STYLE',
      'APP_BASE_URL',
      'PUBLIC_APP_URL',
      'HEALTH_TOKEN',
      'SETTINGS_ENCRYPTION_KEY',
      'DB_SSL',
      'DB_SSL_REJECT_UNAUTHORIZED',
      'SETTINGS_ENCRYPTION_KEY_PREVIOUS',
      'PLATFORM_TENANT_ID',
      'TURNSTILE_SECRET_KEY',
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'FACEBOOK_OAUTH_CLIENT_ID',
      'FACEBOOK_OAUTH_CLIENT_SECRET',
      'SUPPORT_CONTACT_URL',
      'OTP_SMS_ALLOWED_PREFIXES',
      'TRIAL_DAYS',
      'TRIAL_SEAT_LIMIT',
      'TURNSTILE_SITE_KEY',
      'SENTRY_DSN_WEB',
      'SENTRY_ENVIRONMENT',
      'SENTRY_TRACES_SAMPLE_RATE',
      'APP_VERSION',
      'SENTRY_RELEASE',
      'DEMO_MODE',
      'DEMO_PASSWORD',
    ]);
    expect(keys.length).toBeGreaterThan(20);
    const unclassified = keys.filter(
      (k) =>
        !notProvider.has(k) &&
        !runStagingConfigCheck({ ...staging, [k]: 'live-value-123' }).output.includes(
          `${k} must be empty on staging`,
        ),
    );
    expect(unclassified).toEqual([]);
  });

  it('passes a staging env with no provider', () => {
    expect(runStagingConfigCheck(staging)).toEqual({ ok: true, output: 'config ok' });
  });

  // A real provider key must block the staging deploy (D25). The value must never be printed.
  it('fails when a provider variable is set, naming it but not its value', () => {
    for (const key of [
      'PLATFORM_SMS_API_KEY',
      'SMS_PROVIDER',
      'WHATSAPP_ACCESS_TOKEN',
      'SMTP_HOST',
      'PLATFORM_ALERT_PHONES',
    ]) {
      const result = runStagingConfigCheck({ ...staging, [key]: 'live-value-123' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain(key);
      expect(result.output).not.toContain('live-value-123');
    }
  });

  it('accepts an empty provider variable (compose passes empty strings)', () => {
    expect(runStagingConfigCheck({ ...staging, SMTP_HOST: '' }).ok).toBe(true);
  });

  it('fails on a prod database or a real Turnstile secret', () => {
    const result = runStagingConfigCheck({
      ...staging,
      POSTGRES_DB: 'biddaloy',
      TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal',
    });
    expect(result.ok).toBe(false);
    for (const name of ['POSTGRES_DB', 'TURNSTILE_SECRET_KEY']) {
      expect(result.output).toContain(name);
    }
    expect(result.output).not.toContain('0x4AAAAAAAreal');
  });

  it('judges the .env itself: demo mode and the staging bucket must be set there', () => {
    const result = runStagingConfigCheck({ ...staging, DEMO_MODE: 'false', S3_BUCKET: 'biddaloy' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('DEMO_MODE');
    expect(result.output).toContain('S3_BUCKET');
  });

  it('fails without DEMO_PASSWORD (the demo guards need it)', () => {
    const result = runStagingConfigCheck({ ...staging, DEMO_PASSWORD: '' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('DEMO_PASSWORD');
  });

  it('--file reads only the file, never the calling shell env', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cc-')), 'env');
    writeFileSync(file, 'S3_BUCKET=biddaloy-staging\n');
    const env = loadEnvFile(file, { SMTP_HOST: 'from-shell' });
    expect(env).toEqual({ S3_BUCKET: 'biddaloy-staging' });
    expect(loadEnvFile(undefined, { SMTP_HOST: 'x' })).toEqual({ SMTP_HOST: 'x' });
  });

  it('still runs the production checks', () => {
    const bad = { ...staging, JWT_SECRET: 'replace-me-replace-me-replace-me-123' };
    expect(runStagingConfigCheck(bad).ok).toBe(false);
  });
});
