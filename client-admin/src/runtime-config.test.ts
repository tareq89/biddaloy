import { afterEach, describe, expect, it } from 'vitest';

import { runtimeConfig } from './runtime-config';

afterEach(() => {
  delete window.__BIDDALOY_CONFIG__;
});

describe('runtimeConfig', () => {
  it('falls back to empty values and a 0.1 rate when the global is missing', () => {
    expect(runtimeConfig()).toEqual({
      turnstileSiteKey: '',
      supportUrl: '',
      sentryDsn: '',
      sentryEnvironment: '',
      sentryTracesSampleRate: 0.1,
      release: '',
      messageSinkUrl: '',
      envBadge: '',
      envBadgeDate: '',
    });
  });

  it('reads the values the server rendered', () => {
    window.__BIDDALOY_CONFIG__ = { turnstileSiteKey: 'k', sentryEnvironment: 'staging' };
    expect(runtimeConfig().turnstileSiteKey).toBe('k');
    expect(runtimeConfig().sentryEnvironment).toBe('staging');
  });
});
