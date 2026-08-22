import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureRouteError,
  initSentry,
  updateSentryRouteTag,
  updateSentryTenantTag,
} from './sentry';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}));

/** Both hooks are configured synchronously by `initSentry` — the `|
 * PromiseLike<...>` half of their return types only matters for a real
 * async `beforeSend`/`beforeBreadcrumb`, which this module's never is. */
function runBeforeSend(event: Partial<ErrorEvent>): ErrorEvent | null {
  const options = vi.mocked(Sentry.init).mock.calls.at(-1)?.[0];
  if (!options?.beforeSend) throw new Error('initSentry did not register a beforeSend hook');
  return options.beforeSend(event as ErrorEvent, {}) as ErrorEvent | null;
}

function runBeforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const options = vi.mocked(Sentry.init).mock.calls.at(-1)?.[0];
  if (!options?.beforeBreadcrumb) {
    throw new Error('initSentry did not register a beforeBreadcrumb hook');
  }
  return options.beforeBreadcrumb(breadcrumb, undefined);
}

describe('initSentry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when no DSN is configured — local dev/CI without one wired up', () => {
    initSentry({ dsn: undefined, environment: 'test' });
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes with sendDefaultPii explicitly disabled', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'production' });

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@sentry.example/1',
        environment: 'production',
        sendDefaultPii: false,
      }),
    );
  });
});

describe('beforeSend PII scrubbing', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redacts an email and a BD phone number from the message and exception values', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeSend({
      message: 'Failed to notify admin@example.com',
      exception: {
        values: [{ type: 'Error', value: 'SMS lookup failed for 01712345678' }],
      },
    });

    expect(result?.message).toBe('Failed to notify [REDACTED_EMAIL]');
    expect(result?.exception?.values?.[0]?.value).toBe('SMS lookup failed for [REDACTED_PHONE]');
  });

  it('strips the request body/cookies/headers and redacts a sensitive query string', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeSend({
      request: {
        url: 'https://app.biddaloy.test/api/students?token=super-secret-token',
        data: { password: 'hunter2' },
        cookies: { session: 'abc' },
        headers: { Authorization: 'Bearer abc' },
      },
    });

    expect(result?.request?.data).toBeUndefined();
    expect(result?.request?.cookies).toBeUndefined();
    expect(result?.request?.headers).toBeUndefined();
    expect(result?.request?.url).toBe('https://app.biddaloy.test/api/students?token=[REDACTED]');
  });

  it('strips arbitrary extra context and user context wholesale, even amount-shaped data', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeSend({
      extra: { amount: 500, guardianName: 'Karim Rahman' },
      user: { email: 'guardian@example.com' },
    });

    expect(result?.extra).toBeUndefined();
    expect(result?.user).toBeUndefined();
  });

  it('redacts PII on a failing-request-shaped event, not just a successful one', () => {
    // #36's own lesson: a redaction helper that only runs on the happy path
    // is worthless, since the leak is usually in an error log written
    // under debugging pressure — this event shape mirrors a 500 whose
    // error detail happens to echo the request that failed.
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeSend({
      message: 'Request failed',
      exception: {
        values: [
          {
            type: 'ApiError',
            value:
              'POST /students failed — duplicate guardian phone 01812345678 for guardian@example.com',
          },
        ],
      },
      request: {
        url: 'https://app.biddaloy.test/api/students?access_token=leaked-token-value',
      },
    });

    expect(result?.exception?.values?.[0]?.value).toBe(
      'POST /students failed — duplicate guardian phone [REDACTED_PHONE] for [REDACTED_EMAIL]',
    );
    expect(result?.request?.url).toBe(
      'https://app.biddaloy.test/api/students?access_token=[REDACTED]',
    );
  });
});

describe('beforeBreadcrumb', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redacts PII from a breadcrumb message', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeBreadcrumb({
      category: 'ui.click',
      message: 'Clicked row for admin@example.com',
    });

    expect(result?.message).toBe('Clicked row for [REDACTED_EMAIL]');
  });

  it('strips a body-shaped data key defensively, even though the default fetch/XHR breadcrumbs never set one', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeBreadcrumb({
      category: 'fetch',
      data: { url: 'https://app.biddaloy.test/api/payments', request_body: '{"amount":500}' },
    });

    expect(result?.data).not.toHaveProperty('request_body');
    expect(result?.data?.url).toBe('https://app.biddaloy.test/api/payments');
  });
});

describe('tag helpers', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('updateSentryTenantTag sets only the opaque tenant id, never a name', () => {
    updateSentryTenantTag('tenant-123');
    expect(Sentry.setTag).toHaveBeenCalledWith('tenantId', 'tenant-123');
  });

  it('updateSentryRouteTag sets the route id', () => {
    updateSentryRouteTag('/students/$studentId');
    expect(Sentry.setTag).toHaveBeenCalledWith('route', '/students/$studentId');
  });
});

describe('captureRouteError', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the caught error to Sentry.captureException', () => {
    const error = new Error('boom');
    captureRouteError(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
