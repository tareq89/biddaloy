import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { assertMessageSinkAllowed, validate } from './env.validation';

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
  COCKPIT_DOMAIN: 'cockpit.school.org',
  COCKPIT_OWNER_1_EMAIL: 'owner1@school.org',
  COCKPIT_OWNER_1_PHONE: '+8801711111111',
  COCKPIT_OWNER_2_EMAIL: 'owner2@school.org',
  COCKPIT_OWNER_2_PHONE: '+8801722222222',
};

describe('BILLING_FREE_UNTIL (49.4)', () => {
  it('accepts a valid ISO date with an offset, in production too', () => {
    expect(() =>
      validate({ ...prodConfig, BILLING_FREE_UNTIL: '2027-01-01T00:00:00+06:00' }),
    ).not.toThrow();
  });

  it('rejects an invalid value in every env', () => {
    expect(() => validate({ ...prodConfig, NODE_ENV: 'test', BILLING_FREE_UNTIL: 'soon' })).toThrow(
      /BILLING_FREE_UNTIL/,
    );
  });

  it('production refuses a date with no offset', () => {
    expect(() => validate({ ...prodConfig, BILLING_FREE_UNTIL: '2027-01-01' })).toThrow(
      /explicit offset/,
    );
  });
});

const ZONE = 'a'.repeat(32);

describe('Cloudflare custom-domain pair (40.4.08)', () => {
  it('production refuses only one of the token and the zone', () => {
    expect(() => validate({ ...prodConfig, CF_SAAS_API_TOKEN: 'tok' })).toThrow(/CF_ZONE_ID/);
    expect(() => validate({ ...prodConfig, CF_ZONE_ID: ZONE })).toThrow(/CF_SAAS_API_TOKEN/);
  });

  it('production accepts both or neither (neither = custom domains off)', () => {
    expect(() =>
      validate({ ...prodConfig, CF_SAAS_API_TOKEN: 'tok', CF_ZONE_ID: ZONE }),
    ).not.toThrow();
    expect(() => validate(prodConfig)).not.toThrow();
  });

  it('production refuses a zone id that is not 32 lower-case hex characters', () => {
    expect(() => validate({ ...prodConfig, CF_SAAS_API_TOKEN: 'tok', CF_ZONE_ID: 'zone' })).toThrow(
      /32-character/,
    );
    expect(() =>
      validate({ ...prodConfig, CF_SAAS_API_TOKEN: 'tok', CF_ZONE_ID: 'A'.repeat(32) }),
    ).toThrow(/32-character/);
  });
});

describe('Umami pair (40.4.08)', () => {
  const url = 'https://umami.example.org';
  it('production refuses only one of the URL and the token', () => {
    expect(() => validate({ ...prodConfig, UMAMI_API_URL: url })).toThrow(/UMAMI_API_TOKEN/);
    expect(() => validate({ ...prodConfig, UMAMI_API_TOKEN: 't' })).toThrow(/UMAMI_API_URL/);
  });

  it('production refuses a URL that is not https', () => {
    expect(() =>
      validate({ ...prodConfig, UMAMI_API_URL: 'http://umami.example.org', UMAMI_API_TOKEN: 't' }),
    ).toThrow(/https/);
  });

  it('production refuses a URL with a query string or fragment', () => {
    for (const bad of ['https://umami.example.org/?x=1', 'https://umami.example.org/#f']) {
      expect(() => validate({ ...prodConfig, UMAMI_API_URL: bad, UMAMI_API_TOKEN: 't' })).toThrow(
        /UMAMI_API_URL/,
      );
    }
  });

  it('production accepts both https URL and token, or neither', () => {
    expect(() =>
      validate({ ...prodConfig, UMAMI_API_URL: url, UMAMI_API_TOKEN: 't' }),
    ).not.toThrow();
    expect(() => validate(prodConfig)).not.toThrow();
  });

  it('production refuses a tracker script URL that is not https, and accepts an https one', () => {
    expect(() =>
      validate({ ...prodConfig, UMAMI_SCRIPT_URL: 'http://u.example.org/s.js' }),
    ).toThrow(/UMAMI_SCRIPT_URL/);
    expect(() =>
      validate({ ...prodConfig, UMAMI_SCRIPT_URL: 'https://u.example.org/script.js' }),
    ).not.toThrow();
  });

  it('production refuses a script URL the tracker guard would drop', () => {
    expect(() =>
      validate({ ...prodConfig, UMAMI_SCRIPT_URL: 'https://u.example.org/s.js"x' }),
    ).toThrow(/UMAMI_SCRIPT_URL/);
  });
});

describe('Turnstile keys (Epic 79)', () => {
  it('production refuses only one of the site key and the secret', () => {
    expect(() => validate({ ...prodConfig, TURNSTILE_SITE_KEY: 'site' })).toThrow(/TURNSTILE/);
    expect(() => validate({ ...prodConfig, TURNSTILE_SECRET_KEY: 'secret' })).toThrow(/TURNSTILE/);
  });

  it('production accepts both or neither', () => {
    expect(() =>
      validate({ ...prodConfig, TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' }),
    ).not.toThrow();
    expect(() => validate(prodConfig)).not.toThrow();
  });

  it('rejects a sample rate outside 0 to 1', () => {
    expect(() => validate({ ...prodConfig, SENTRY_TRACES_SAMPLE_RATE: '5' })).toThrow();
  });

  it('treats an empty sample rate as unset', () => {
    expect(() => validate({ ...prodConfig, SENTRY_TRACES_SAMPLE_RATE: '' })).not.toThrow();
  });
});

describe('SITE_ROOT_DOMAIN (Epic 40)', () => {
  it('accepts a bare host, and unset or empty', () => {
    expect(() =>
      validate({ ...validConfig, SITE_ROOT_DOMAIN: 'schoolmanagerp.com' }),
    ).not.toThrow();
    expect(() => validate({ ...validConfig, SITE_ROOT_DOMAIN: 'sites.e2e.test' })).not.toThrow();
    expect(() => validate({ ...validConfig, SITE_ROOT_DOMAIN: '' })).not.toThrow();
    expect(() => validate({ ...validConfig, SITE_ROOT_DOMAIN: 'localhost' })).not.toThrow();
    expect(() => validate(validConfig)).not.toThrow();
  });

  // Any of these would make every `<sub>.<root>` host fail to match, so all sites 404.
  it('rejects a scheme, a port, a trailing dot or upper case', () => {
    expect(() => validate({ ...validConfig, SITE_ROOT_DOMAIN: 'https://x.com' })).toThrow(
      /SITE_ROOT_DOMAIN/,
    );
    expect(() => validate({ ...validConfig, SITE_ROOT_DOMAIN: 'x.com:443' })).toThrow();
    expect(() => validate({ ...validConfig, SITE_ROOT_DOMAIN: 'x.com.' })).toThrow();
    expect(() => validate({ ...validConfig, SITE_ROOT_DOMAIN: 'X.com' })).toThrow();
  });
});

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

  it('refuses the test-only OUTBOUND_TEST_ALLOW_LOOPBACK flag on production (#3324)', () => {
    expect(() => validate({ ...prodConfig, OUTBOUND_TEST_ALLOW_LOOPBACK: 'true' })).toThrow(
      /OUTBOUND_TEST_ALLOW_LOOPBACK/,
    );
    expect(() =>
      validate({ ...validConfig, NODE_ENV: 'test', OUTBOUND_TEST_ALLOW_LOOPBACK: 'true' }),
    ).not.toThrow();
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

  it('rejects an all-digit JWT_SECRET, a repeated pattern, or under 8 distinct characters', () => {
    expect(() => validate({ ...prodConfig, JWT_SECRET: 'a'.repeat(40) })).toThrow(/too weak/);
    expect(() => validate({ ...prodConfig, JWT_SECRET: '1234567890'.repeat(4) })).toThrow(
      /too weak/,
    );
    expect(() => validate({ ...prodConfig, JWT_SECRET: 'abcdefg'.repeat(6) })).toThrow(/too weak/);
    // 8 distinct characters, but one substring repeated.
    expect(() => validate({ ...prodConfig, JWT_SECRET: 'abcde123'.repeat(4) })).toThrow(
      /repeated pattern/,
    );
    expect(() => validate({ ...prodConfig, JWT_SECRET_PREVIOUS: 'a'.repeat(40) })).toThrow(
      /JWT_SECRET_PREVIOUS is too weak/,
    );
  });

  it('accepts real random secrets: hex (even missing digits) and UUIDs', () => {
    // 64-char hex missing the digit "f": 15 distinct symbols, a normal `openssl rand -hex 32` outcome.
    const hex64 = '3a9c0e1d7b42865e0c3d9a1b7e24068c5d3e9b0a17c46e82d0b5a39c71e4d8b2';
    // 32-char hex with only 8 distinct symbols (rare but real for `openssl rand -hex 16`).
    const hex32 = '4b0c2a13c0b4a2310ac3b2140a3c1b42';
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

describe('DEMO_MODE / DEMO_PASSWORD', () => {
  it('fails when DEMO_MODE=true has no DEMO_PASSWORD', () => {
    expect(() => validate({ ...validConfig, DEMO_MODE: 'true' })).toThrow(/DEMO_PASSWORD/);
  });

  it('fails when the DEMO_PASSWORD is shorter than 8 characters', () => {
    expect(() => validate({ ...validConfig, DEMO_MODE: 'true', DEMO_PASSWORD: 'short' })).toThrow(
      /DEMO_PASSWORD/,
    );
  });

  it('passes when DEMO_MODE=true has a DEMO_PASSWORD', () => {
    expect(() =>
      validate({ ...validConfig, DEMO_MODE: 'true', DEMO_PASSWORD: 'demo-pass-1' }),
    ).not.toThrow();
  });

  it('passes with DEMO_MODE unset', () => {
    expect(() => validate(validConfig)).not.toThrow();
  });
});

describe('assertMessageSinkAllowed (87 D22)', () => {
  it('refuses mailpit on prod', () => {
    expect(() => assertMessageSinkAllowed('prod', 'mailpit')).toThrow('MESSAGE_SINK');
  });
  it.each([
    ['staging', undefined],
    ['demo', 'real'],
  ])('requires mailpit on %s (got %s)', (env, sink) => {
    expect(() => assertMessageSinkAllowed(env, sink)).toThrow(
      `MESSAGE_SINK must be mailpit on ${env}`,
    );
  });
  it.each([
    ['prod', undefined],
    ['prod', 'real'],
    ['staging', 'mailpit'],
    ['demo', 'mailpit'],
    [undefined, 'mailpit'],
    [undefined, undefined],
    ['dev', 'real'],
  ])('passes for (%s, %s)', (env, sink) => {
    expect(() => assertMessageSinkAllowed(env, sink)).not.toThrow();
  });
  it('lets staging, and only staging, opt out of the inbox', () => {
    expect(() => assertMessageSinkAllowed('staging', 'real', 'true')).not.toThrow();
    expect(() => assertMessageSinkAllowed('staging', 'real', 'yes')).toThrow('must be mailpit');
    expect(() => assertMessageSinkAllowed('demo', 'real', 'true')).toThrow('must be mailpit');
    expect(() => assertMessageSinkAllowed('prod', 'mailpit', 'true')).toThrow('not be mailpit');
  });
  it('validates the sink variables', () => {
    expect(() => validate({ ...validConfig, MESSAGE_SINK: 'bogus' })).toThrow();
    expect(() => validate({ ...validConfig, MESSAGE_SINK_SMTP_URL: 'http://x:1025' })).toThrow();
    expect(() =>
      validate({
        ...validConfig,
        MESSAGE_SINK: 'mailpit',
        MESSAGE_SINK_SMTP_URL: 'smtp://mailpit:1025',
        MESSAGE_SINK_PUBLIC_URL: 'http://localhost:8025',
      }),
    ).not.toThrow();
  });
});

describe('cockpit owners (98 #3737)', () => {
  const owners = [
    'COCKPIT_DOMAIN',
    'COCKPIT_OWNER_1_EMAIL',
    'COCKPIT_OWNER_1_PHONE',
    'COCKPIT_OWNER_2_EMAIL',
    'COCKPIT_OWNER_2_PHONE',
  ] as const;

  it.each(owners)('production refuses a missing %s, naming it', (key) => {
    const rest: Record<string, unknown> = { ...prodConfig };
    delete rest[key];
    expect(() => validate(rest)).toThrow(new RegExp(`${key} is required`));
  });

  it('production refuses equal or malformed owner emails and phones', () => {
    expect(() => validate({ ...prodConfig, COCKPIT_OWNER_2_EMAIL: 'OWNER1@school.org' })).toThrow(
      /EMAIL and COCKPIT_OWNER_2_EMAIL must differ/,
    );
    expect(() => validate({ ...prodConfig, COCKPIT_OWNER_1_EMAIL: 'nope' })).toThrow(
      /COCKPIT_OWNER_1_EMAIL must be a valid email/,
    );
    expect(() =>
      validate({ ...prodConfig, COCKPIT_OWNER_2_PHONE: prodConfig.COCKPIT_OWNER_1_PHONE }),
    ).toThrow(/PHONE and COCKPIT_OWNER_2_PHONE must differ/);
    expect(() => validate({ ...prodConfig, COCKPIT_OWNER_1_PHONE: '01711111111' })).toThrow(
      /COCKPIT_OWNER_1_PHONE must be an E.164/,
    );
  });

  it('error text never carries the value', () => {
    const run = () => validate({ ...prodConfig, COCKPIT_OWNER_1_PHONE: '01799999999' });
    expect(run).toThrow(/COCKPIT_OWNER_1_PHONE/);
    expect(run).not.toThrow('01799999999');
  });

  it('demo mode needs no owners', () => {
    const rest: Record<string, unknown> = { ...prodConfig, DEMO_MODE: 'true' };
    for (const k of owners) delete rest[k];
    let message = '';
    try {
      validate(rest);
    } catch (e) {
      message = String(e);
    }
    expect(message).not.toMatch(/COCKPIT/);
  });

  it('COCKPIT_TEST_TOTP_SECRET is refused in production and accepted in test', () => {
    expect(() => validate({ ...prodConfig, COCKPIT_TEST_TOTP_SECRET: 'JBSWY3DPEHPK3PXP' })).toThrow(
      /COCKPIT_TEST_TOTP_SECRET/,
    );
    expect(() =>
      validate({ ...validConfig, NODE_ENV: 'test', COCKPIT_TEST_TOTP_SECRET: 'JBSWY3DPEHPK3PXP' }),
    ).not.toThrow();
  });

  it('DEMO_MODE with SMOKE_COCKPIT_* outside staging lists the SMOKE_COCKPIT_* refusals', () => {
    const rest: Record<string, unknown> = {
      ...prodConfig,
      DEMO_MODE: 'true',
      DEMO_PASSWORD: 'demo-pass-1',
      SMOKE_COCKPIT_EMAIL: 's@school.org',
      SMOKE_COCKPIT_PASSWORD: 'pw-for-smoke-1234',
      SMOKE_COCKPIT_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    };
    let lines: string[] = [];
    try {
      validate(rest);
    } catch (e) {
      lines = String(e).split('\n- ');
    }
    for (const k of ['EMAIL', 'PASSWORD', 'TOTP_SECRET']) {
      expect(lines).toContain(`SMOKE_COCKPIT_${k} is allowed only when ENV_NAME=staging`);
    }
  });

  it('SMOKE_COCKPIT_* are accepted only with ENV_NAME=staging', () => {
    const smoke = {
      SMOKE_COCKPIT_EMAIL: 's@school.org',
      SMOKE_COCKPIT_PASSWORD: 'pw-for-smoke-1234',
      SMOKE_COCKPIT_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    };
    expect(() => validate({ ...prodConfig, ...smoke })).toThrow(/SMOKE_COCKPIT_EMAIL is allowed/);
    expect(() => validate({ ...prodConfig, ...smoke, ENV_NAME: 'prod' })).toThrow(
      /SMOKE_COCKPIT_TOTP_SECRET is allowed/,
    );
    expect(() => validate({ ...prodConfig, ...smoke, ENV_NAME: 'staging' })).not.toThrow();
  });
});
