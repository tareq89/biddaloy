import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'dotenv';
import {
  COMMON_REQUIRED,
  loadEnvFile,
  runConfigCheck,
  runProductionConfigCheck,
  runStackConfigCheck,
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

describe('runStackConfigCheck', () => {
  // The .env exactly as an operator writes it: infra/secrets/<stack>.example.env with its keys
  // filled in. Not `...valid`: that already holds DATABASE_URL, which compose (not the .env)
  // builds, and hid that gap once.
  const fill: Record<string, string> = {
    APP_VERSION: '0'.repeat(40),
    APP_BASE_URL: 'https://school.example.org',
    PUBLIC_APP_URL: 'https://school.example.org',
    CORS_ORIGINS: 'https://school.example.org',
    POSTGRES_USER: 'app',
    POSTGRES_PASSWORD: 'Zq8vR2mXw4Lp',
    JWT_SECRET: valid.JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY: valid.SETTINGS_ENCRYPTION_KEY,
    HEALTH_TOKEN: 'h7Kp2Vx9Qm4Lr8Tz',
    S3_ACCESS_KEY_ID: 'k9Zr2Qv7',
    S3_SECRET_ACCESS_KEY: 'Lm4Xw8Tb3Nc6Hy1Pd5Sf',
    BACKUP_AGE_PUBLIC_KEY: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    STAGING_PASSWORD: 'Stage-Pass-2026',
    DEMO_PASSWORD: 'Demo-Public-2026',
    // the bucket and database name differ per stack
    S3_BUCKET: 'biddaloy-STACK',
    POSTGRES_DB: 'biddaloy_STACK',
    // deploy/stack.yml passes an unset rate as "", which env.validation rejects: always fill it
    SENTRY_TRACES_SAMPLE_RATE: '0.1',
    // a stack that holds a Turnstile pair in its example keeps it; prod gets a matching pair
    TURNSTILE_SITE_KEY: '0x4AAAAAAAsite',
    TURNSTILE_SECRET_KEY: '0x4AAAAAAAsecret',
    // keys the example leaves empty on staging/demo on purpose stay empty
  };
  const emptyOnPurpose = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'FACEBOOK_OAUTH_CLIENT_ID',
    'FACEBOOK_OAUTH_CLIENT_SECRET',
    'PLATFORM_SMS_PROVIDER',
    'PLATFORM_SMS_API_KEY',
    'PLATFORM_SMS_SENDER_ID',
    'PLATFORM_SMS_API_URL',
    'PLATFORM_ALERT_PHONES',
  ];

  /** The example file with every empty key filled; non-empty example values stay as written. */
  function filled(stack: 'prod' | 'staging' | 'demo'): Record<string, string> {
    const example = parse(readFileSync(join(repoRoot, `infra/secrets/${stack}.example.env`)));
    return Object.fromEntries(
      Object.entries(example).map(([k, v]) => {
        if (v !== '' || emptyOnPurpose.includes(k)) return [k, v];
        const dummy = (fill[k] ?? '').replace('STACK', stack);
        return [k, dummy];
      }),
    );
  }
  const prod = { ...filled('prod'), S3_BUCKET: 'biddaloy', POSTGRES_DB: 'biddaloy' };
  const staging = filled('staging');
  const demo = filled('demo');

  it('each example file with dummy values passes its own --env', () => {
    expect(runStackConfigCheck('prod', prod)).toEqual({ ok: true, output: 'config ok' });
    expect(runStackConfigCheck('staging', staging)).toEqual({ ok: true, output: 'config ok' });
    expect(runStackConfigCheck('demo', demo)).toEqual({ ok: true, output: 'config ok' });
  });

  it('COMMON_REQUIRED is every `:?` variable the app container needs in deploy/stack.yml', () => {
    const compose = readFileSync(join(repoRoot, 'deploy/stack.yml'), 'utf8');
    for (const key of COMMON_REQUIRED) expect(compose, key).toContain(`\${${key}:?`);
  });

  it('fails when a required variable is missing, per stack', () => {
    for (const [stack, env, key] of [
      ['prod', prod, 'BACKUP_AGE_PUBLIC_KEY'],
      ['staging', staging, 'STAGING_PASSWORD'],
      ['demo', demo, 'DEMO_PASSWORD'],
      ['prod', prod, 'POSTGRES_PASSWORD'],
    ] as const) {
      const result = runStackConfigCheck(stack, { ...env, [key]: '' });
      expect(result.ok, `${stack} ${key}`).toBe(false);
      expect(result.output).toContain(key);
    }
  });

  it('fails an env file made for another stack', () => {
    const result = runStackConfigCheck('prod', staging);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('ENV_NAME must be prod');
  });

  it('staging with DEMO_MODE=true fails', () => {
    const result = runStackConfigCheck('staging', { ...staging, DEMO_MODE: 'true' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('DEMO_MODE must be false on staging');
  });

  it('staging with a short STAGING_PASSWORD fails, without printing it', () => {
    const result = runStackConfigCheck('staging', { ...staging, STAGING_PASSWORD: 'short-pw-11' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('STAGING_PASSWORD');
    expect(result.output).not.toContain('short-pw-11');
  });

  it('staging pointing at a prod bucket or prod database name fails', () => {
    const result = runStackConfigCheck('staging', {
      ...staging,
      S3_BUCKET: 'biddaloy',
      POSTGRES_DB: 'biddaloy',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('S3_BUCKET');
    expect(result.output).toContain('POSTGRES_DB');
  });

  it('staging with a real Turnstile secret fails, without printing it', () => {
    const result = runStackConfigCheck('staging', {
      ...staging,
      TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal',
    });
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain('0x4AAAAAAAreal');
  });

  it('staging with a provider variable set fails, naming it but not its value', () => {
    for (const key of [
      'PLATFORM_SMS_API_KEY',
      'SMS_PROVIDER',
      'SMTP_HOST',
      'PLATFORM_ALERT_PHONES',
    ]) {
      const result = runStackConfigCheck('staging', { ...staging, [key]: 'live-value-123' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain(key);
      expect(result.output).not.toContain('live-value-123');
    }
    expect(runStackConfigCheck('staging', { ...staging, SMTP_HOST: '' }).ok).toBe(true);
  });

  it('demo with a bucket not containing demo fails', () => {
    const result = runStackConfigCheck('demo', { ...demo, S3_BUCKET: 'biddaloy' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('S3_BUCKET');
  });

  it('demo needs DEMO_MODE=true; prod refuses it', () => {
    expect(runStackConfigCheck('demo', { ...demo, DEMO_MODE: 'false' }).ok).toBe(false);
    expect(runStackConfigCheck('prod', { ...prod, DEMO_MODE: 'true' }).ok).toBe(false);
  });

  it('one Turnstile key alone fails, on every stack', () => {
    for (const [stack, env] of [
      ['prod', prod],
      ['staging', staging],
      ['demo', demo],
    ] as const) {
      const siteOnly = runStackConfigCheck(stack, { ...env, TURNSTILE_SECRET_KEY: '' });
      const secretOnly = runStackConfigCheck(stack, { ...env, TURNSTILE_SITE_KEY: '' });
      expect(siteOnly.output, stack).toContain('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY');
      expect(secretOnly.output, stack).toContain('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY');
    }
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
    expect(runStackConfigCheck('staging', bad).ok).toBe(false);
  });
});
