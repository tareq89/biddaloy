import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpanJSON, TransactionEvent } from './sentry';
import {
  captureQueueFailure,
  captureRouteError,
  initSentry,
  recordRouteChunkFallback,
  resetQueueFailureReporting,
  updateSentryRouteTag,
  updateSentryTenantTag,
} from './sentry';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  tanstackRouterBrowserTracingIntegration: vi.fn(() => ({
    name: 'TanStackRouterBrowserTracing',
  })),
}));

/** Stands in for the app's TanStack Router instance — `initSentry` only
 * ever forwards it to Sentry's integration, so its shape is irrelevant
 * here beyond being the identity that gets passed through. */
const router = { subscribe: vi.fn() };

/** Both hooks are configured synchronously by `initSentry` — the `|
 * PromiseLike<...>` half of their return types only matters for a real
 * async `beforeSend`/`beforeBreadcrumb`, which this module's never is. */
function runBeforeSend(event: Partial<ErrorEvent>): ErrorEvent | null {
  const options = vi.mocked(Sentry.init).mock.calls.at(-1)?.[0];
  if (!options?.beforeSend) throw new Error('initSentry did not register a beforeSend hook');
  return options.beforeSend(event as ErrorEvent, {}) as ErrorEvent | null;
}

function runBeforeSendTransaction(event: Partial<TransactionEvent>): TransactionEvent | null {
  const options = vi.mocked(Sentry.init).mock.calls.at(-1)?.[0];
  if (!options?.beforeSendTransaction) {
    throw new Error('initSentry did not register a beforeSendTransaction hook');
  }
  return options.beforeSendTransaction(event as TransactionEvent, {}) as TransactionEvent | null;
}

function runBeforeSendSpan(span: Partial<SpanJSON>): SpanJSON {
  const options = vi.mocked(Sentry.init).mock.calls.at(-1)?.[0];
  if (!options?.beforeSendSpan) {
    throw new Error('initSentry did not register a beforeSendSpan hook');
  }
  return options.beforeSendSpan(span as SpanJSON);
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

  it('strips contexts wholesale, even guardian-shaped data', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeSend({
      contexts: { guardian: { email: 'guardian@example.com' } },
    });

    expect(result?.contexts).toBeUndefined();
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

  it('[8.12.7] drops an amount-shaped data key — an allow-list, since a number has no PII shape to match', () => {
    // The reason the bag is an allow-list rather than a redaction pass:
    // `{ amount: 500 }` is indistinguishable from telemetry to any
    // regex, so the only structural control is "unknown key, dropped".
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeBreadcrumb({
      category: 'fetch',
      data: {
        url: 'https://app.biddaloy.test/api/payments',
        amount: 500,
        guardianName: 'Karim Rahman',
        status_code: 500,
      },
    });

    expect(result?.data).not.toHaveProperty('amount');
    expect(result?.data).not.toHaveProperty('guardianName');
    // Known telemetry keys still come through, numbers included.
    expect(result?.data?.url).toBe('https://app.biddaloy.test/api/payments');
    expect(result?.data?.status_code).toBe(500);
  });

  it('drops a nested/object-shaped data value instead of passing it through unredacted', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test' });

    const result = runBeforeBreadcrumb({
      category: 'fetch',
      data: {
        url: 'https://app.biddaloy.test/api/students',
        guardian: { email: 'guardian@example.com' },
      },
    });

    expect(result?.data).not.toHaveProperty('guardian');
    expect(result?.data?.url).toBe('https://app.biddaloy.test/api/students');
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

  it('updateSentryRouteTag falls back to the constant "unknown", never a caller-supplied pathname, when no route id is given', () => {
    updateSentryRouteTag(undefined);
    expect(Sentry.setTag).toHaveBeenCalledWith('route', 'unknown');
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

describe('[8.12.7] browser tracing wiring', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers the TanStack Router tracing integration against the app router', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'production', router });

    expect(Sentry.tanstackRouterBrowserTracingIntegration).toHaveBeenCalledWith(router);
    expect(vi.mocked(Sentry.init).mock.calls.at(-1)?.[0]?.integrations).toEqual([
      expect.objectContaining({ name: 'TanStackRouterBrowserTracing' }),
    ]);
  });

  it('registers no tracing integration when no router is supplied', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'production' });

    expect(Sentry.tanstackRouterBrowserTracingIntegration).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.init).mock.calls.at(-1)?.[0]?.integrations).toEqual([]);
  });

  it('samples 10% of transactions by default, so a traffic spike cannot exhaust the quota', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'production', router });

    expect(vi.mocked(Sentry.init).mock.calls.at(-1)?.[0]?.tracesSampleRate).toBe(0.1);
  });

  it('honours an in-range configured sample rate', () => {
    initSentry({
      dsn: 'https://key@sentry.example/1',
      environment: 'production',
      router,
      tracesSampleRate: 0.25,
    });

    expect(vi.mocked(Sentry.init).mock.calls.at(-1)?.[0]?.tracesSampleRate).toBe(0.25);
  });

  it.each([
    ['a typo that would mean 100% of traffic', 10],
    ['a negative value', -1],
    ['a non-numeric env var parsed to NaN', Number.NaN],
  ])('falls back to the default rather than obeying %s', (_label, rate) => {
    initSentry({
      dsn: 'https://key@sentry.example/1',
      environment: 'production',
      router,
      tracesSampleRate: rate,
    });

    expect(vi.mocked(Sentry.init).mock.calls.at(-1)?.[0]?.tracesSampleRate).toBe(0.1);
  });
});

describe('[8.12.7] beforeSendTransaction PII scrubbing', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /** PII planted in every carrier a transaction event has: the
   * transaction name, a span description and its attribute bag, the
   * trace context's data, the request, breadcrumbs, plus the
   * `extra`/`user`/`contexts.*` bags the error path already strips. */
  function transactionWithPiiEverywhere(): Partial<TransactionEvent> {
    return {
      type: 'transaction',
      transaction: '/students/guardian@example.com',
      measurements: {
        lcp: { value: 2400, unit: 'millisecond' },
        cls: { value: 0.05, unit: '' },
        inp: { value: 180, unit: 'millisecond' },
      },
      contexts: {
        trace: {
          trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          span_id: 'bbbbbbbbbbbbbbbb',
          op: 'navigation',
          data: {
            'http.url': 'https://app.biddaloy.test/api/students?token=super-secret-token',
            guardian: { name: 'Karim Rahman' },
          },
        },
        guardian: { email: 'guardian@example.com' },
      },
      spans: [
        {
          span_id: 'cccccccccccccccc',
          trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          start_timestamp: 1,
          timestamp: 2,
          description: 'GET /api/guardians?phone=01712345678&access_token=leaked',
          op: 'http.client',
          data: {
            'http.url': 'https://app.biddaloy.test/api/guardians/admin@example.com',
            request_body: '{"amount":500,"name":"Karim Rahman"}',
            nested: { amount: 500 },
            amount: 500,
            'http.response.status_code': 200,
            // A nested value under an allowed key. Cast because
            // `SpanAttributes` forbids it at the type level — the point
            // is that a *runtime* payload can still carry one.
          } as Record<string, unknown> as NonNullable<TransactionEvent['spans']>[number]['data'],
        },
      ],
      request: {
        url: 'https://app.biddaloy.test/students?access_token=leaked-token-value',
        method: 'GET',
        data: { guardianName: 'Karim Rahman', amount: 500 },
        cookies: { session: 'abc' },
        headers: { Authorization: 'Bearer abc' },
      },
      breadcrumbs: [
        { category: 'fetch', message: 'GET for admin@example.com', data: { amount: 500 } },
      ],
      tags: { tenantId: 'tenant-123', route: '/students/$studentId' },
      extra: { amount: 500, guardianName: 'Karim Rahman' },
      user: { email: 'guardian@example.com', ip_address: '203.0.113.4' },
    };
  }

  it('lets the Web Vitals measurements through untouched — the point of the whole issue', () => {
    // A scrubber that also strips telemetry turns this feature into a
    // silent no-op: the dashboard stays empty and nothing fails loudly.
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test', router });

    const result = runBeforeSendTransaction(transactionWithPiiEverywhere());

    expect(result?.measurements).toEqual({
      lcp: { value: 2400, unit: 'millisecond' },
      cls: { value: 0.05, unit: '' },
      inp: { value: 180, unit: 'millisecond' },
    });
    // And the trace ids survive, or the event is unlinkable in Sentry.
    expect(result?.contexts?.trace).toMatchObject({
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      span_id: 'bbbbbbbbbbbbbbbb',
      op: 'navigation',
    });
  });

  it('strips extra/user and every non-trace context, even guardian-shaped ones', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test', router });

    const result = runBeforeSendTransaction(transactionWithPiiEverywhere());

    expect(result?.extra).toBeUndefined();
    expect(result?.user).toBeUndefined();
    expect(result?.contexts).not.toHaveProperty('guardian');
  });

  it('redacts the transaction name and the trace context data bag', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test', router });

    const result = runBeforeSendTransaction(transactionWithPiiEverywhere());

    expect(result?.transaction).toBe('/students/[REDACTED_EMAIL]');
    expect(result?.contexts?.trace?.data?.['http.url']).toBe(
      // The whole query string goes, not just the keys a deny-list
      // recognises: this app puts free text (`?search=Karim Rahman`) in
      // the query, and no regex can tell a name from a page title.
      'https://app.biddaloy.test/api/students?[REDACTED_QUERY]',
    );
    expect(result?.contexts?.trace?.data).not.toHaveProperty('guardian');
  });

  it('redacts span descriptions and scrubs span attribute bags', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test', router });

    const span = runBeforeSendTransaction(transactionWithPiiEverywhere())?.spans?.[0];

    expect(span?.description).toBe('GET /api/guardians?[REDACTED_QUERY]');
    expect(span?.data['http.url']).toBe('https://app.biddaloy.test/api/guardians/[REDACTED_EMAIL]');
    expect(span?.data).not.toHaveProperty('request_body');
    expect(span?.data).not.toHaveProperty('nested');
    // Non-PII attributes still make it through — the scrub is targeted,
    // not a blanket wipe that would make the spans useless.
    expect(span?.data['http.response.status_code']).toBe(200);
  });

  it('applies the same request allow-list as the error path, and re-scrubs breadcrumbs', () => {
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test', router });

    const result = runBeforeSendTransaction(transactionWithPiiEverywhere());

    expect(result?.request?.data).toBeUndefined();
    expect(result?.request?.cookies).toBeUndefined();
    expect(result?.request?.headers).toBeUndefined();
    expect(result?.request?.url).toBe('https://app.biddaloy.test/students?access_token=[REDACTED]');
    expect(result?.breadcrumbs?.[0]?.message).toBe('GET for [REDACTED_EMAIL]');
  });

  it('drops an unrecognised top-level key rather than forwarding it — allow-list, not deny-list', () => {
    // The structural guarantee: a field a future SDK version adds to
    // `TransactionEvent` (here, a made-up one carrying a name) is absent
    // by default instead of shipping until someone notices.
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test', router });

    const result = runBeforeSendTransaction({
      type: 'transaction',
      ...({ future_field: { guardianName: 'Karim Rahman' } } as object),
    });

    expect(result).not.toHaveProperty('future_field');
  });

  it('serializes to JSON containing no planted PII at all', () => {
    // The belt-and-braces version of every assertion above: whatever the
    // event's shape, none of these strings may appear anywhere in the
    // payload that would go over the wire.
    initSentry({ dsn: 'https://key@sentry.example/1', environment: 'test', router });

    const serialized = JSON.stringify(runBeforeSendTransaction(transactionWithPiiEverywhere()));

    for (const secret of [
      'guardian@example.com',
      'admin@example.com',
      '01712345678',
      'Karim Rahman',
      '500',
      'leaked-token-value',
      'super-secret-token',
      'Bearer abc',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('[8.12.7] recordRouteChunkFallback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(['offline', 'update'] as const)(
    'leaves a fixed-string breadcrumb for the %s fork, carrying no URL or error text',
    (kind) => {
      recordRouteChunkFallback(kind);

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'app.chunk',
        level: 'info',
        type: 'default',
        message: 'Route load failed; rendered the offline/update recovery state',
        data: { kind },
      });
    },
  );

  it('does not open a Sentry issue of its own', () => {
    // [8.12.7] settled epic #101's deferred question: the assets are
    // served by the same NestJS process as the API, so an online chunk
    // 404 is a stale tab after a deploy, not a masked CDN outage.
    recordRouteChunkFallback('update');

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('[8.12.7] captureQueueFailure', () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetQueueFailureReporting();
  });

  it('forwards the error itself, and nothing about the queued row', () => {
    const error = new Error('DatabaseClosedError');
    captureQueueFailure(error);

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('reports only once per session — a broken IndexedDB fails on every replay tick', () => {
    captureQueueFailure(new Error('DatabaseClosedError'));
    captureQueueFailure(new Error('QuotaExceededError'));
    captureQueueFailure(new Error('DatabaseClosedError'));

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe('[8.12.7] the two PII paths that bypassed the transaction scrubber', () => {
  beforeEach(() => {
    initSentry({ dsn: 'https://key@example.ingest.sentry.io/1', environment: 'test', router });
  });

  it('scrubs a standalone INP span, which never passes through beforeSendTransaction', () => {
    // INP is emitted as its own span envelope (`startTrackingINP` →
    // `sendSpanEnvelope`), which applies `beforeSendSpan` and nothing
    // else. Its name is a DOM path Sentry builds from the element's
    // attributes — so a row action rendered as
    // `<button aria-label="Delete Aisha Rahman">` shipped a student's
    // name with every other scrubber in this file bypassed.
    const span = runBeforeSendSpan({
      span_id: 'a',
      trace_id: 'b',
      start_timestamp: 1,
      op: 'ui.interaction.click',
      description: 'button[aria-label="Delete Aisha Rahman"] > span.label',
      data: { 'sentry.exclusive_time': 12 },
    });

    expect(span.description).not.toMatch(/Aisha|Rahman/);
    expect(span.description).toContain('button');
  });

  it('drops the query string from url attributes, where this app puts free text', () => {
    // `/students?search=Karim+Rahman` is what the list screens produce
    // from the search box, and the tracing integration writes that whole
    // URL to `url.full` on every navigation span.
    const span = runBeforeSendSpan({
      span_id: 'a',
      trace_id: 'b',
      start_timestamp: 1,
      description: 'GET /api/v1/students?search=Karim+Rahman',
      data: {
        'url.full': 'https://app.biddaloy.test/students?search=Karim+Rahman',
        'http.url': 'https://app.biddaloy.test/api/v1/students?search=Karim+Rahman',
      },
    });

    expect(JSON.stringify(span)).not.toMatch(/Karim|Rahman/);
    // The path survives — it is what makes the telemetry useful.
    expect(span.data['url.full']).toContain('/students');
  });

  it('scrubs span link attributes, which a spread carried out untouched', () => {
    const span = runBeforeSendSpan({
      span_id: 'a',
      trace_id: 'b',
      start_timestamp: 1,
      data: {},
      links: [
        {
          span_id: 'c',
          trace_id: 'd',
          attributes: { guardianName: 'Karim Rahman', 'sentry.link.type': 'previous_trace' },
        },
      ],
    });

    expect(JSON.stringify(span)).not.toMatch(/Karim|Rahman/);
    // Links themselves are kept: dropping them silently disables
    // previous-trace linking.
    expect(span.links).toHaveLength(1);
    expect(span.links?.[0]?.attributes?.['sentry.link.type']).toBe('previous_trace');
  });
});

describe('[8.12.7] queue-failure reporting is deduplicated per error, not per session', () => {
  beforeEach(() => {
    resetQueueFailureReporting();
    initSentry({ dsn: 'https://key@example.ingest.sentry.io/1', environment: 'test', router });
    vi.mocked(Sentry.captureException).mockClear();
  });

  it('never reports a database closed by logout, and does not let it silence the session', () => {
    // `clearAuthState()` deletes the database under the replay loop. That
    // is what logout *does* — expected control flow, not a fault. A
    // single session-wide latch meant this benign error consumed the one
    // report the session was allowed.
    captureQueueFailure(Object.assign(new Error('closed'), { name: 'DatabaseClosedError' }));
    expect(Sentry.captureException).not.toHaveBeenCalled();

    captureQueueFailure(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('reports each distinct failure once, not each occurrence', () => {
    const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    captureQueueFailure(quota());
    captureQueueFailure(quota());
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);

    captureQueueFailure(Object.assign(new Error('other'), { name: 'VersionError' }));
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });
});
