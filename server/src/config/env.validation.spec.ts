import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { validate } from './env.validation';

const validConfig = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/biddaloy',
  JWT_SECRET: 'a'.repeat(32),
};

// A production env that passes every assertProductionConfig rule.
const prodConfig = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:Zq8vR2mXw4Lp@db:5432/biddaloy',
  JWT_SECRET: 'k9Zr2Qv7Lm4Xw8Tb3Nc6Hy1Pd5Sf0Ja2Ug',
  SETTINGS_ENCRYPTION_KEY: 'Fh3Jd9Kc2Vb7Nx5Mz1Qw8Er4Ty6Ui0OpLk3Ase=',
  APP_BASE_URL: 'https://app.school.org',
  PUBLIC_APP_URL: 'https://app.school.org',
  CORS_ORIGINS: 'https://app.school.org,https://admin.school.org',
  S3_ACCESS_KEY_ID: 'AKIA7QW3ER9TY2UI',
  S3_SECRET_ACCESS_KEY: 'sk9Jd3Kc7Vb1Nx5Mz8Qw2Er4Ty6Ui0Op',
};

describe('assertProductionConfig (via validate)', () => {
  it('accepts a fully valid production env', () => {
    expect(() => validate(prodConfig)).not.toThrow();
  });

  it('rejects a replace-me JWT_SECRET and never prints the value', () => {
    const bad = 'replace-me-replace-me-replace-me-123';
    const run = () => validate({ ...prodConfig, JWT_SECRET: bad });
    expect(run).toThrow(/JWT_SECRET/);
    expect(run).not.toThrow(bad);
  });

  it('rejects change-me in S3_SECRET_ACCESS_KEY', () => {
    expect(() => validate({ ...prodConfig, S3_SECRET_ACCESS_KEY: 'change-me' })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
  });

  it('rejects a DATABASE_URL whose password is a placeholder', () => {
    expect(() =>
      validate({ ...prodConfig, DATABASE_URL: 'postgres://app:change-me@db:5432/biddaloy' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an all-digit JWT_SECRET or one with under 8 distinct characters', () => {
    expect(() => validate({ ...prodConfig, JWT_SECRET: 'a'.repeat(40) })).toThrow(/too weak/);
    expect(() => validate({ ...prodConfig, JWT_SECRET: '1234567890'.repeat(4) })).toThrow(
      /too weak/,
    );
    expect(() => validate({ ...prodConfig, JWT_SECRET: 'abcdefg'.repeat(6) })).toThrow(/too weak/);
    expect(() => validate({ ...prodConfig, JWT_SECRET_PREVIOUS: 'a'.repeat(40) })).toThrow(
      /JWT_SECRET_PREVIOUS is too weak/,
    );
  });

  it('accepts real random secrets: hex (even missing digits) and UUIDs', () => {
    // 64-char hex missing the digit "f": 15 distinct symbols, a normal `openssl rand -hex 32` outcome.
    const hex64 = '0123456789abcde'.repeat(5).slice(0, 64);
    // 32-char hex with only 8 distinct symbols (rare but real for `openssl rand -hex 16`).
    const hex32 = '01234abc'.repeat(4);
    const uuidSecret = '3f2b8c1e-9a4d-4e67-b5c0-7d1a2e8f9b34-3f2b8c1e';
    for (const secret of [hex64, hex32, uuidSecret]) {
      expect(() => validate({ ...prodConfig, JWT_SECRET: secret })).not.toThrow();
      expect(() => validate({ ...prodConfig, JWT_SECRET_PREVIOUS: secret })).not.toThrow();
    }
  });

  it('rejects JWT_SECRET equal to SETTINGS_ENCRYPTION_KEY', () => {
    expect(() =>
      validate({ ...prodConfig, SETTINGS_ENCRYPTION_KEY: prodConfig.JWT_SECRET }),
    ).toThrow(/differ from SETTINGS_ENCRYPTION_KEY/);
  });

  it('rejects JWT_SECRET equal to JWT_SECRET_PREVIOUS', () => {
    expect(() => validate({ ...prodConfig, JWT_SECRET_PREVIOUS: prodConfig.JWT_SECRET })).toThrow(
      /differ from JWT_SECRET_PREVIOUS/,
    );
  });

  it('accepts a distinct, strong JWT_SECRET_PREVIOUS', () => {
    expect(() =>
      validate({ ...prodConfig, JWT_SECRET_PREVIOUS: 'Bn4Hy7Gt2Fr9Dc6Xs1Zq3We5Ru8Io0PlMk' }),
    ).not.toThrow();
  });

  it('rejects a missing SETTINGS_ENCRYPTION_KEY, APP_BASE_URL and PUBLIC_APP_URL', () => {
    const {
      SETTINGS_ENCRYPTION_KEY: _a,
      APP_BASE_URL: _b,
      PUBLIC_APP_URL: _c,
      ...rest
    } = prodConfig;
    expect(() => validate(rest)).toThrow(
      /SETTINGS_ENCRYPTION_KEY[\s\S]*APP_BASE_URL[\s\S]*PUBLIC_APP_URL/,
    );
  });

  it('rejects a CORS_ORIGINS entry with a trailing slash', () => {
    expect(() => validate({ ...prodConfig, CORS_ORIGINS: 'https://a.school.org/' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('reports every problem in one error', () => {
    expect(() =>
      validate({ ...prodConfig, JWT_SECRET: 'a'.repeat(40), CORS_ORIGINS: '*' }),
    ).toThrow(/too weak[\s\S]*CORS_ORIGINS/);
  });

  it.each(['test', 'development'])('leaves the same bad values alone under NODE_ENV=%s', (env) => {
    expect(() =>
      validate({
        ...validConfig,
        NODE_ENV: env,
        S3_SECRET_ACCESS_KEY: 'change-me',
        CORS_ORIGINS: 'https://a.com/',
        JWT_SECRET: 'replace-me-replace-me-replace-me-123',
      }),
    ).not.toThrow();
  });
});

describe('env.validation', () => {
  it('accepts a config with all required fields present and valid', () => {
    expect(() => validate(validConfig)).not.toThrow();
  });

  it('rejects a missing JWT_SECRET', () => {
    const { JWT_SECRET: _omit, ...rest } = validConfig;
    expect(() => validate(rest)).toThrow();
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => validate({ ...validConfig, JWT_SECRET: 'a'.repeat(31) })).toThrow();
  });

  it('accepts a JWT_SECRET exactly 32 characters', () => {
    expect(() => validate({ ...validConfig, JWT_SECRET: 'a'.repeat(32) })).not.toThrow();
  });

  it('accepts NODE_ENV=development', () => {
    expect(() => validate({ ...validConfig, NODE_ENV: 'development' })).not.toThrow();
  });

  it('accepts NODE_ENV=test', () => {
    expect(() => validate({ ...validConfig, NODE_ENV: 'test' })).not.toThrow();
  });

  it('accepts NODE_ENV=production', () => {
    expect(() => validate(prodConfig)).not.toThrow();
  });

  it('rejects an unrecognized NODE_ENV', () => {
    expect(() => validate({ ...validConfig, NODE_ENV: 'staging' })).toThrow();
  });

  it('accepts a missing NODE_ENV', () => {
    expect(() => validate(validConfig)).not.toThrow();
  });

  it('accepts a missing RATE_LIMIT_DEFAULT_LIMIT / RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate(validConfig)).not.toThrow();
  });

  describe('PLATFORM_TENANT_ID (context.guard.ts)', () => {
    // No config-time default anymore (#620): no database actually has a
    // predictable hardcoded id to default to (the `MultiTenantAuth`
    // migration creates the real "Default School" row with a random uuid).
    // `TenantStatusService.platformTenantId()` discovers it dynamically
    // outside production instead — see context.guard.spec.ts.
    it('stays unset outside production when unset — no config-time default', () => {
      const result = validate({ ...validConfig, NODE_ENV: 'development' });
      expect(result.PLATFORM_TENANT_ID).toBeUndefined();
    });

    it('stays unset under NODE_ENV=test too', () => {
      const result = validate({ ...validConfig, NODE_ENV: 'test' });
      expect(result.PLATFORM_TENANT_ID).toBeUndefined();
    });

    it('stays unset in production — fails closed, requires explicit ops config', () => {
      const result = validate(prodConfig);
      expect(result.PLATFORM_TENANT_ID).toBeUndefined();
    });

    it('passes through an explicitly set PLATFORM_TENANT_ID unchanged', () => {
      const result = validate({
        ...validConfig,
        NODE_ENV: 'development',
        PLATFORM_TENANT_ID: 'custom-platform-tenant',
      });
      expect(result.PLATFORM_TENANT_ID).toBe('custom-platform-tenant');
    });
  });

  it('accepts positive integer strings for RATE_LIMIT_DEFAULT_LIMIT and RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() =>
      validate({
        ...validConfig,
        RATE_LIMIT_DEFAULT_LIMIT: '250',
        RATE_LIMIT_DEFAULT_TTL_MS: '30000',
      }),
    ).not.toThrow();
  });

  // These reject malformed RATE_LIMIT_DEFAULT_LIMIT values at startup —
  // without them, a value like "abc" or "-1" would reach
  // resolveDefaultRateLimit()'s Number() conversion as NaN or a negative
  // limit instead of failing fast with a clear boot error.
  it('rejects a non-numeric RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: 'abc' })).toThrow();
  });

  it('rejects a RATE_LIMIT_DEFAULT_LIMIT with trailing non-digit characters', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '10px' })).toThrow();
  });

  it('rejects a negative RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '-1' })).toThrow();
  });

  it('rejects a zero RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '0' })).toThrow();
  });

  it('rejects a non-integer RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '1.5' })).toThrow();
  });

  it('rejects an empty-string RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '' })).toThrow();
  });

  it('rejects a whitespace-only RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: ' ' })).toThrow();
  });

  // Same malformed-value coverage for RATE_LIMIT_DEFAULT_TTL_MS — it's
  // validated by an identical positive-integer pattern (see env.validation.ts).
  it('rejects a non-numeric RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: 'abc' })).toThrow();
  });

  it('rejects a RATE_LIMIT_DEFAULT_TTL_MS with trailing non-digit characters', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '10px' })).toThrow();
  });

  it('rejects a negative RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '-1' })).toThrow();
  });

  it('rejects a zero RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '0' })).toThrow();
  });

  it('rejects a non-integer RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '1.5' })).toThrow();
  });

  it('rejects an empty-string RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '' })).toThrow();
  });

  it('rejects a whitespace-only RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: ' ' })).toThrow();
  });
});
