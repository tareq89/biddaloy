import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadEnvFile,
  runConfigCheck,
  runProductionConfigCheck,
  runStagingConfigCheck,
  TURNSTILE_TEST_SECRET,
} from './config-check';

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
  const staging = {
    ...valid,
    DEMO_MODE: 'true',
    DEMO_PASSWORD: 'Demo-Public-2026',
    POSTGRES_DB: 'biddaloy_staging',
    S3_BUCKET: 'biddaloy-staging',
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
  };

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

  it('fails on a prod database, prod bucket, real Turnstile secret or DEMO_MODE off', () => {
    const result = runStagingConfigCheck({
      ...staging,
      DEMO_MODE: undefined,
      POSTGRES_DB: 'biddaloy',
      S3_BUCKET: 'biddaloy',
      TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal',
    });
    expect(result.ok).toBe(false);
    for (const name of ['DEMO_MODE', 'POSTGRES_DB', 'S3_BUCKET', 'TURNSTILE_SECRET_KEY']) {
      expect(result.output).toContain(name);
    }
    expect(result.output).not.toContain('0x4AAAAAAAreal');
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
