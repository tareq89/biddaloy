/**
 * [8.9.8]'s Sentry wiring — reports render/route errors with route and
 * tenant context, but **never PII** (#36's server-side posture: no names,
 * phones, emails, or amounts). `main.tsx` calls `initSentry` once at
 * startup and keeps the tenant/route tags current via
 * `updateSentryTenantTag`/`updateSentryRouteTag`; `../components/route-
 * error-boundary.tsx` calls `captureRouteError` from its fallback.
 *
 * [8.12.7] completed the setup: passing `main.tsx`'s router to
 * `initSentry` turns on browser tracing, which is what collects real-user
 * **LCP/CLS/INP** and names transactions after the route id.
 *
 * Turning tracing on opened two egress paths the error scrubber never
 * saw, so there are now four hooks, not two:
 *
 *   - `beforeSend` / `beforeBreadcrumb` — errors and their trail.
 *   - `beforeSendTransaction` — pageload/navigation events and their
 *     child spans. LCP and CLS ride here, as `measurements`, and pass
 *     through untouched.
 *   - `beforeSendSpan` — **standalone** spans, which do *not* go through
 *     `beforeSendTransaction`. INP is emitted this way, and its span name
 *     is a DOM path Sentry builds from the element's `aria-label`, `alt`
 *     and `title`. Without this hook, a button labelled "Delete Aisha
 *     Rahman" shipped that name with every other scrubber bypassed.
 *
 * Two rules the scrubbers apply that a reader would not guess:
 * **query strings are dropped from URLs entirely** (this app puts free
 * text in them — `/students?search=Karim+Rahman`), and free-form bags are
 * rebuilt from an allow-list rather than filtered by pattern, because an
 * amount (`{ amount: 500 }`) and a name have no shape a regex can spot.
 * Adding a key to that allow-list is a data-protection decision.
 *
 * No DSN configured (local dev, CI, a preview build without one wired up)
 * — `initSentry` is a no-op, same "missing config degrades gracefully"
 * shape as `enableMocking()` in `main.tsx`. Source maps and the release
 * tag are the build's job, not this module's: `client-admin/
 * vite.config.ts` uploads them when `SENTRY_AUTH_TOKEN` is set.
 */
import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent, Event, RequestEventData } from '@sentry/react';

/** `@sentry/react` re-exports `ErrorEvent` but not its transaction
 * counterpart, so the performance-event shapes are derived from the
 * `Event` union it does export rather than reaching past the package
 * boundary into `@sentry/core` (not a declared dependency of `ui`). */
export type TransactionEvent = Event & { type: 'transaction' };
export type SpanJSON = NonNullable<Event['spans']>[number];

// Same shapes as `server/src/common/redact-log.util.ts` (#36) — duplicated
// rather than imported, since `ui` can't reach across the `server`/`ui`
// package boundary. Keep both in sync if the email/phone/sensitive-key
// shapes ever change.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /(?:\+?880|0)1[3-9]\d{8}/g;
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:password|token|access_token|refresh_token|secret|api_key|apikey)=)[^&\s]+/gi;

function redactPii(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]');
}

/**
 * Strips the query string off anything URL-shaped, keeping the path.
 *
 * Not optional, and not covered by `redactPii`: this app puts **free
 * text** in the query string. `/students?search=Karim+Rahman` is what the
 * list screens produce when someone uses the search box
 * (`client-admin/src/routes/_staff/students/index.tsx` declares `search`
 * as a URL search param), and the tracing integration writes that whole
 * URL to `url.full` on every navigation span, plus the fetch span's
 * description and `http.url`. A regex cannot tell a person's name from a
 * page title, so the only safe move is to drop the query entirely.
 *
 * Pagination and sort params go with it. That is a real loss of debugging
 * detail, and it is the right trade: the alternative is exporting
 * guardians' and students' names on the app's busiest screens.
 */
function stripQueryString(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : `${value.slice(0, cut)}?[REDACTED_QUERY]`;
}

/**
 * The DOM path Sentry derives for an INP span, minus anything carrying
 * user text.
 *
 * `htmlTreeAsString` builds names like
 * `button[aria-label="Delete Aisha Rahman"]`, appending `aria-label`,
 * `title`, `alt`, `name` and `type` verbatim — so a row-action button or
 * a photo's alt text puts a student's name straight into a span name.
 * Every bracketed attribute selector is removed; tag, id and class
 * survive, which is enough to identify the control.
 */
function stripAttributeSelectors(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Keys allowed through a free-form key/value bag — breadcrumb `data`, a
 * span's attributes, the trace context's `data`.
 *
 * An **allow-list**, because the alternative cannot work: an amount
 * (`{ amount: 500 }`) and a name have no shape a regex can recognise, so
 * a deny-list only catches the PII that happens to look like PII. What
 * is listed here is the telemetry the SDK's own instrumentation emits —
 * the `sentry.*`/`http.*`/`url.*`/`server.*`/`network.*`/`browser.*`
 * attribute namespaces from OpenTelemetry's semantic conventions, the
 * fetch/XHR breadcrumb fields, and `kind` from
 * `recordRouteChunkFallback`. Anything else is dropped, so the way to
 * ship a new field is to add it here deliberately and have a reviewer
 * see it.
 */
const ALLOWED_DATA_KEY_PREFIXES = ['sentry.', 'http.', 'url.', 'server.', 'network.', 'browser.'];
const ALLOWED_DATA_KEYS = new Set([
  'url',
  'method',
  'status_code',
  'request_body_size',
  'response_body_size',
  'from',
  'to',
  'kind',
]);

function isAllowedDataKey(key: string): boolean {
  return (
    ALLOWED_DATA_KEYS.has(key) || ALLOWED_DATA_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Applies the allow-list above, then redacts what is left.
 *
 * A nested (object/array) value is dropped even under an allowed key: a
 * flat regex pass over a top-level string can't reach PII buried inside
 * one, and no default instrumentation puts an object in these bags
 * anyway (`FetchBreadcrumbData`/`XhrBreadcrumbData` and the `http.*`
 * attributes are all primitives).
 */
function scrubDataBag(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(
        ([key, value]) =>
          isAllowedDataKey(key) &&
          !/body/i.test(key) &&
          (value === null || typeof value !== 'object'),
      )
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? redactPii(sanitiseIfUrlKey(key, value)) : value,
      ]),
  );
}

/** URL-valued keys lose their query string; see `stripQueryString`. */
function sanitiseIfUrlKey(key: string, value: string): string {
  return key === 'url' ||
    key.startsWith('url.') ||
    key === 'http.url' ||
    key === 'to' ||
    key === 'from'
    ? stripQueryString(value)
    : value;
}

function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const { data, ...rest } = breadcrumb;
  return {
    ...rest,
    ...(breadcrumb.message !== undefined && { message: redactPii(breadcrumb.message) }),
    ...(data !== undefined && { data: scrubDataBag(data) }),
  };
}

/**
 * An explicit allow-list, not a deny-list — `data`/`cookies`/`headers`
 * (a request body, session cookies, an Authorization header) are never
 * forwarded, full stop, rather than trusting a deny-list to keep up with
 * every field Sentry's request-data capture might ever add. Shared by the
 * error and transaction scrubbers so the two can't drift.
 */
function allowListRequest(request: RequestEventData): RequestEventData {
  const { url, method, query_string: queryString, env } = request;
  return {
    ...(url !== undefined && { url: redactPii(url) }),
    ...(method !== undefined && { method }),
    ...(queryString !== undefined && {
      query_string: typeof queryString === 'string' ? redactPii(queryString) : queryString,
    }),
    ...(env !== undefined && { env }),
  };
}

/**
 * Amounts (fee/payment values) have no distinct shape a regex can catch —
 * the real control is upstream discipline: nothing in this codebase should
 * ever pass component props/state into `Sentry.captureException`'s
 * `extra`. `event.extra`/`event.request.data`/`event.contexts` are
 * stripped wholesale here as defense in depth against a future call site
 * doing that by accident, rather than trying to allow-list safe keys —
 * an empty allow-list is the safe default; widen it deliberately if a
 * real, reviewed need ever comes up.
 */
function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };

  if (scrubbed.message !== undefined) {
    scrubbed.message = redactPii(scrubbed.message);
  }
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      values: scrubbed.exception.values.map((value) =>
        value.value !== undefined ? { ...value, value: redactPii(value.value) } : value,
      ),
    };
  }
  if (scrubbed.request) {
    scrubbed.request = allowListRequest(scrubbed.request);
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(redactBreadcrumb);
  }
  delete scrubbed.extra;
  delete scrubbed.user;
  delete scrubbed.contexts;

  return scrubbed;
}

/**
 * [8.12.7]'s performance events. A transaction event is a **different
 * shape** from an error event, so `scrubEvent` above does not cover it:
 * it carries spans (each with its own description and attribute bag), a
 * trace context, and the Web Vitals measurements this issue exists to
 * collect.
 *
 * Built by **construction, not deletion** — the result starts empty and
 * only allow-listed keys are copied in, so a field Sentry adds to
 * `TransactionEvent` in a future SDK release is dropped by default rather
 * than forwarded until someone notices. `contexts` is narrowed to
 * `trace` alone (the error path deletes `contexts` wholesale; a
 * transaction is meaningless without its trace ids).
 *
 * `measurements` — `lcp`/`cls`/`inp` — is copied through **untouched**:
 * they are `{ value: number, unit: string }` records with no free-form
 * string in them, and scrubbing them away would turn this issue's whole
 * point into a silent no-op.
 */
function scrubTransaction(event: TransactionEvent): TransactionEvent {
  const trace = event.contexts?.trace;
  return {
    type: event.type,
    ...(event.event_id !== undefined && { event_id: event.event_id }),
    ...(event.timestamp !== undefined && { timestamp: event.timestamp }),
    ...(event.start_timestamp !== undefined && { start_timestamp: event.start_timestamp }),
    ...(event.platform !== undefined && { platform: event.platform }),
    ...(event.environment !== undefined && { environment: event.environment }),
    ...(event.release !== undefined && { release: event.release }),
    ...(event.dist !== undefined && { dist: event.dist }),
    ...(event.sdk !== undefined && { sdk: event.sdk }),
    ...(event.transaction_info !== undefined && { transaction_info: event.transaction_info }),
    // The route id (`/students/$studentId`), courtesy of the TanStack
    // Router integration's `parameterize`d transaction names — but run
    // through `redactPii` anyway, since a future route could put
    // something email/phone-shaped in a path segment.
    ...(event.transaction !== undefined && { transaction: redactPii(event.transaction) }),
    // Only ever our own opaque `tenantId`/`route` tags plus the SDK's,
    // but string values still get a redaction pass rather than a
    // promise that no future call site ever tags something richer.
    ...(event.tags !== undefined && {
      tags: Object.fromEntries(
        Object.entries(event.tags).map(([key, value]) => [
          key,
          typeof value === 'string' ? redactPii(value) : value,
        ]),
      ),
    }),
    ...(event.measurements !== undefined && { measurements: event.measurements }),
    ...(trace !== undefined && {
      contexts: {
        trace: {
          trace_id: trace.trace_id,
          span_id: trace.span_id,
          ...(trace.parent_span_id !== undefined && { parent_span_id: trace.parent_span_id }),
          ...(trace.op !== undefined && { op: trace.op }),
          ...(trace.status !== undefined && { status: trace.status }),
          ...(trace.origin !== undefined && { origin: trace.origin }),
          ...(trace.data !== undefined && { data: scrubDataBag(trace.data) }),
        },
      },
    }),
    ...(event.spans !== undefined && { spans: event.spans.map(scrubSpan) }),
    ...(event.request !== undefined && { request: allowListRequest(event.request) }),
    // Already scrubbed at creation time by `beforeBreadcrumb`; re-running
    // the same pass here is cheap and means a breadcrumb added by a code
    // path that bypasses that hook still can't ride out on a transaction.
    ...(event.breadcrumbs !== undefined && {
      breadcrumbs: event.breadcrumbs.map(redactBreadcrumb),
    }),
  };
}

/**
 * A span, rebuilt field by field.
 *
 * By construction, not by spread, for the same reason `scrubTransaction`
 * is: a spread ships whatever the SDK adds next. That is not theoretical
 * here — `SpanJSON.links[].attributes` is a free-form bag that v10
 * populates by default (`linkPreviousTrace`), and a spread carried it out
 * completely unfiltered.
 *
 * A span's `description` is typically the fetched URL (query string and
 * all), or — for an INP span — a DOM path built from `aria-label`, `alt`
 * and `title`. Both carry user text, so both are sanitised.
 */
function scrubSpan(span: SpanJSON): SpanJSON {
  const description =
    span.description === undefined
      ? undefined
      : redactPii(stripQueryString(stripAttributeSelectors(span.description)));

  const scrubbed: SpanJSON = {
    span_id: span.span_id,
    trace_id: span.trace_id,
    start_timestamp: span.start_timestamp,
    // Conditional spreads throughout: under `exactOptionalPropertyTypes`
    // an explicit `undefined` is not the same as an absent property.
    ...(span.op !== undefined && { op: span.op }),
    ...(span.status !== undefined && { status: span.status }),
    ...(span.origin !== undefined && { origin: span.origin }),
    ...(span.parent_span_id !== undefined && { parent_span_id: span.parent_span_id }),
    ...(span.timestamp !== undefined && { timestamp: span.timestamp }),
    ...(span.measurements !== undefined && { measurements: span.measurements }),
    // The cast is safe by construction: `scrubDataBag` only ever drops
    // keys or maps a string to a string, so every surviving value still
    // satisfies `SpanAttributes` — which `Record<string, unknown>`
    // cannot express on its own.
    data: scrubDataBag(span.data) as SpanJSON['data'],
    ...(description !== undefined && { description }),
    ...(span.links !== undefined && {
      // Kept, because dropping links silently disables previous-trace
      // linking — but their attribute bag goes through the same
      // allow-list as everything else.
      links: span.links.map((link) => ({
        ...link,
        ...(link.attributes !== undefined && {
          attributes: scrubDataBag(link.attributes) as NonNullable<typeof link.attributes>,
        }),
      })),
    }),
  };

  return scrubbed;
}

/** Sentry's own default is 0.1; stated explicitly because "a traffic
 * spike must not exhaust the quota" is an acceptance criterion, not an
 * implementation detail to inherit from an upstream default. */
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/** Anything outside `[0, 1]` (a typo'd `VITE_SENTRY_TRACES_SAMPLE_RATE`
 * such as `10`, or a `NaN` from a non-numeric value) falls back to the
 * default rather than being clamped to `1` — the failure mode of a
 * mistyped env var must not be "send 100% of traffic". */
function resolveTracesSampleRate(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  return rate;
}

export interface InitSentryOptions {
  /** No-ops when unset — see this module's header comment. */
  dsn: string | undefined;
  environment: string;
  /** [8.12.7]: the app's TanStack Router instance. Passing it turns on
   * browser tracing, which is what collects real-user LCP/CLS/INP and
   * names transactions after the *route id* rather than the resolved
   * pathname. Omitted (tests, an app without a router) — no tracing
   * integration is registered at all. `unknown` rather than `Router`
   * because `ui` stays router-instance-agnostic; Sentry's own signature
   * takes `any` for the same reason. */
  router?: unknown;
  /** Fraction of transactions sampled. Defaults to 0.1 — see
   * `resolveTracesSampleRate`. */
  tracesSampleRate?: number;
}

export function initSentry({
  dsn,
  environment,
  router,
  tracesSampleRate,
}: InitSentryOptions): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: resolveTracesSampleRate(tracesSampleRate),
    // Only when a router was supplied: the integration instruments
    // navigations off that exact instance, and registering browser
    // tracing without one would produce pageload transactions named
    // after raw URLs — the very thing `updateSentryRouteTag` avoids.
    integrations: router ? [Sentry.tanstackRouterBrowserTracingIntegration(router)] : [],
    // Explicit even though it's Sentry's own default — this is the one
    // setting standing between "route + tenant only" and Sentry's usual
    // autofill of IP/cookies/user context, worth stating rather than
    // relying on a default that could change upstream.
    sendDefaultPii: false,
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeSendTransaction: (event: TransactionEvent) => scrubTransaction(event),
    // Standalone spans do NOT pass through `beforeSendTransaction`.
    // INP — one of the three vitals this issue exists to collect — is
    // emitted that way (`startTrackingINP` → `sendSpanEnvelope`), and its
    // span name is a DOM path Sentry builds from the element's
    // `aria-label`/`alt`/`title`. A row action rendered as
    // `<button aria-label="Delete Aisha Rahman">` therefore shipped a
    // student's name to Sentry with every scrubber in this file bypassed.
    beforeSendSpan: (span: SpanJSON) => scrubSpan(span),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => redactBreadcrumb(breadcrumb),
  });
}

/** Opaque tenant id only — never a school name. Called once from
 * `main.tsx`'s `subscribeAuthState` listener, so a mid-session tenant
 * switch keeps this current without a page reload. */
export function updateSentryTenantTag(tenantId: string | null): void {
  Sentry.setTag('tenantId', tenantId ?? undefined);
}

/** The route's static id (e.g. `/students/$studentId`), never the
 * resolved pathname — a resolved dynamic segment could itself be
 * name-shaped depending on what a future route ever puts in a param.
 * Falls back to the constant `'unknown'`, never a caller-supplied
 * pathname, when no matched route is available yet — the fallback lives
 * here rather than at the call site so it can't be bypassed by a future
 * caller reaching for `location.pathname` as a "better than nothing"
 * substitute. Called from `main.tsx`'s `router.subscribe('onResolved',
 * ...)`. */
export function updateSentryRouteTag(routeId: string | undefined): void {
  Sentry.setTag('route', routeId ?? 'unknown');
}

/** Reports a route-render error caught by `../components/route-error-
 * boundary.tsx`'s `RouteErrorFallback`. Route/tenant context comes from
 * the tags above, already current by the time an error boundary mounts —
 * this only needs to forward the error itself. */
export function captureRouteError(error: unknown): void {
  Sentry.captureException(error);
}

/**
 * [8.12.7]: the chunk-load forks of `route-error-boundary.tsx` leave a
 * trail without opening an issue of their own.
 *
 * The decision behind this (epic #101's second deferred question): a
 * missing route chunk while **online** stays unreported. This SPA's
 * assets are served by the same NestJS process as its API (no CDN — see
 * `docs/architecture/07-deployment.md`), so the "assets are down while
 * the API is healthy" outage that would justify a dedicated alert cannot
 * happen here; an asset outage *is* a server outage and is already
 * visible server-side. Online chunk 404s are the expected behaviour of a
 * tab left open across a deploy, and one Sentry issue per deploy would
 * bury real errors.
 *
 * What is worth keeping is context for the *next* real error in the same
 * session. The message is a **fixed string** and the only datum is the
 * fork name — no URL, no chunk name, no error message, since a chunk URL
 * is the one thing here that could carry a query string.
 */
export function recordRouteChunkFallback(kind: 'offline' | 'update'): void {
  Sentry.addBreadcrumb({
    category: 'app.chunk',
    level: 'info',
    type: 'default',
    message: 'Route load failed; rendered the offline/update recovery state',
    data: { kind },
  });
}

/** Reported once per session, deliberately: the failure this covers is an
 * IndexedDB-level fault (a closed database, an exhausted quota), which
 * repeats on every replay tick for as long as it lasts. Without the latch
 * a single broken device would generate an issue per `online` event. */
const reportedQueueFailures = new Set<string>();

/**
 * A database closed underneath the replay loop is what a logout *does*
 * (`clearAuthState()` → `deleteOfflineDb()`), and a tab left open across
 * a couple of logins will produce it routinely. It is expected control
 * flow, not a fault, so it is never reported — and, more importantly, it
 * must not be what consumes the one report a session is allowed.
 */
const EXPECTED_QUEUE_ERROR_NAMES = new Set(['DatabaseClosedError', 'AbortError']);

/**
 * [8.12.7]: the offline mutation queue's own Dexie failures
 * (`../api/mutation-queue.ts`). Those are caught internally so the replay
 * pass can stop cleanly, which means nothing about them ever reached
 * Sentry's global handlers — a queue that silently stopped draining is
 * exactly the failure a user cannot see and cannot report.
 *
 * The **error itself only** is forwarded — never the row, its body, or
 * its `lastError`, all of which are user-authored content. `beforeSend`
 * still scrubs the message on the way out.
 */
export function captureQueueFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : 'UnknownError';
  if (EXPECTED_QUEUE_ERROR_NAMES.has(name)) return;

  // Deduplicated per error *name*, not once per session. A single global
  // latch meant the first failure silenced every later one — and in a PWA
  // whose whole point is tabs left open for days across logins and tenant
  // switches, the first failure is the likeliest to be the least
  // interesting one. Per-name still bounds the volume (a queue stuck in a
  // retry loop reports its error once, not once per pass) while leaving
  // room for a genuinely different failure to be heard.
  if (reportedQueueFailures.has(name)) return;
  reportedQueueFailures.add(name);
  Sentry.captureException(error);
}

/** Test-only: the once-per-session latch above is module state, and a
 * test asserting "reports once" would otherwise poison every test after
 * it. Not exported from `./index.ts` — no app code has a reason to call
 * it, same policy as `stopQueueReplay`. */
export function resetQueueFailureReporting(): void {
  reportedQueueFailures.clear();
}
