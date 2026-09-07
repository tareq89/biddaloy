import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { initSentry } from './sentry';

describe('initSentry', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    Sentry.getCurrentScope().setClient(undefined);
  });

  it('is a no-op when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;

    initSentry();

    expect(Sentry.getClient()).toBeUndefined();
  });

  it('throws at boot when SENTRY_DSN is malformed', () => {
    process.env.SENTRY_DSN = 'not-a-valid-url';

    expect(() => initSentry()).toThrow(/SENTRY_DSN/);
  });

  it('initializes the client when SENTRY_DSN is a valid URL', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';

    initSentry();

    expect(Sentry.getClient()).toBeDefined();
  });
});

describe('initSentry beforeSend/beforeBreadcrumb scrubbing', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    initSentry();
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
    Sentry.getCurrentScope().setClient(undefined);
  });

  it('redacts PII from exception message, breadcrumb, and drops event.request', () => {
    const client = Sentry.getClient();
    const options = client?.getOptions();

    const event = options?.beforeSend?.(
      {
        exception: { values: [{ type: 'Error', value: 'failed for guardian@example.com' }] },
        request: { url: '/api/v1/students', method: 'GET' },
      } as any,
      {} as any,
    );

    expect(event?.request).toBeUndefined();
    expect(event?.exception?.values?.[0].value).toContain('[REDACTED_EMAIL]');
    expect(event?.exception?.values?.[0].value).not.toContain('guardian@example.com');

    const breadcrumb = options?.beforeBreadcrumb?.(
      { message: 'contacted 01711111111', type: 'default' } as any,
      {} as any,
    );
    expect(breadcrumb?.message).toContain('[REDACTED_PHONE]');
    expect(breadcrumb?.message).not.toContain('01711111111');
  });
});
