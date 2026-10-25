import { describe, expect, it } from 'vitest';

import { buildRuntimeConfig, renderRuntimeConfig } from './runtime-config';

describe('buildRuntimeConfig', () => {
  it('exposes exactly the public keys, never a secret', () => {
    const cfg = buildRuntimeConfig({ TURNSTILE_SECRET_KEY: 'secret', JWT_SECRET: 'x' });
    expect(Object.keys(cfg).sort()).toEqual([
      'release',
      'sentryDsn',
      'sentryEnvironment',
      'sentryTracesSampleRate',
      'supportUrl',
      'turnstileSiteKey',
    ]);
    expect(JSON.stringify(cfg)).not.toContain('secret');
  });

  it('uses defaults when env is empty', () => {
    expect(buildRuntimeConfig({ NODE_ENV: 'production' })).toEqual({
      turnstileSiteKey: '',
      supportUrl: '',
      sentryDsn: '',
      sentryEnvironment: 'production',
      sentryTracesSampleRate: 0.1,
      release: '',
    });
  });

  it('treats an empty sample rate as unset, but keeps an explicit 0', () => {
    expect(buildRuntimeConfig({ SENTRY_TRACES_SAMPLE_RATE: '' }).sentryTracesSampleRate).toBe(0.1);
    expect(buildRuntimeConfig({ SENTRY_TRACES_SAMPLE_RATE: '0' }).sentryTracesSampleRate).toBe(0);
  });

  it('passes SENTRY_ENVIRONMENT through', () => {
    expect(buildRuntimeConfig({ SENTRY_ENVIRONMENT: 'staging' }).sentryEnvironment).toBe('staging');
  });
});

describe('renderRuntimeConfig', () => {
  it('escapes < so a value cannot close a script tag', () => {
    const body = renderRuntimeConfig({ SUPPORT_CONTACT_URL: 'https://x/</script><b>' });
    expect(body).not.toContain('<');
    expect(body.startsWith('window.__BIDDALOY_CONFIG__=')).toBe(true);
  });
});
