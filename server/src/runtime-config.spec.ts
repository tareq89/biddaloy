import { describe, expect, it } from 'vitest';

import { buildRuntimeConfig, renderRuntimeConfig } from './runtime-config';

describe('buildRuntimeConfig', () => {
  it('exposes exactly the public keys, never a secret', () => {
    const cfg = buildRuntimeConfig({ TURNSTILE_SECRET_KEY: 'secret', JWT_SECRET: 'x' });
    expect(Object.keys(cfg).sort()).toEqual([
      'envBadge',
      'envBadgeDate',
      'messageSinkUrl',
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
      messageSinkUrl: '',
      envBadge: '',
      envBadgeDate: '',
    });
  });

  it('passes the env badge through', () => {
    const cfg = buildRuntimeConfig({ ENV_BADGE: 'STAGING', ENV_BADGE_DATE: '2026-10-29' });
    expect([cfg.envBadge, cfg.envBadgeDate]).toEqual(['STAGING', '2026-10-29']);
  });

  it('exposes the inbox URL only when MESSAGE_SINK=mailpit', () => {
    const url = 'https://inbox.demo.school.example';
    expect(
      buildRuntimeConfig({ MESSAGE_SINK: 'mailpit', MESSAGE_SINK_PUBLIC_URL: url }).messageSinkUrl,
    ).toBe(url);
    expect(buildRuntimeConfig({ MESSAGE_SINK_PUBLIC_URL: url }).messageSinkUrl).toBe('');
    expect(
      buildRuntimeConfig({ MESSAGE_SINK: 'real', MESSAGE_SINK_PUBLIC_URL: url }).messageSinkUrl,
    ).toBe('');
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
