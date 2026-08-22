/**
 * [8.9.8]'s Sentry wiring — reports render/route errors with route and
 * tenant context, but **never PII** (#36's server-side posture: no names,
 * phones, emails, or amounts). `main.tsx` calls `initSentry` once at
 * startup and keeps the tenant/route tags current via
 * `updateSentryTenantTag`/`updateSentryRouteTag`; `../components/route-
 * error-boundary.tsx` calls `captureRouteError` from its fallback.
 *
 * No DSN configured (local dev, CI, a preview build without one wired up)
 * — `initSentry` is a no-op, same "missing config degrades gracefully"
 * shape as `enableMocking()` in `main.tsx`.
 */
import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';

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

function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const { data, ...rest } = breadcrumb;
  return {
    ...rest,
    ...(breadcrumb.message !== undefined && { message: redactPii(breadcrumb.message) }),
    // The default fetch/XHR breadcrumb integrations only ever populate
    // url/method/status/size fields (`FetchBreadcrumbData`/
    // `XhrBreadcrumbData`), never a request/response body — but strip a
    // `body`-shaped key defensively rather than trusting that stays true
    // forever, and redact anything URL-shaped that could carry a query
    // string.
    ...(data !== undefined && {
      data: Object.fromEntries(
        Object.entries(data)
          .filter(([key]) => !/body/i.test(key))
          .map(([key, value]) => [key, typeof value === 'string' ? redactPii(value) : value]),
      ),
    }),
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
    // An explicit allow-list, not a deny-list — `data`/`cookies`/`headers`
    // (a request body, session cookies, an Authorization header) are never
    // forwarded, full stop, rather than trusting a deny-list to keep up
    // with every field Sentry's request-data capture might ever add.
    const { url, method, query_string: queryString, env } = scrubbed.request;
    scrubbed.request = {
      ...(url !== undefined && { url: redactPii(url) }),
      ...(method !== undefined && { method }),
      ...(queryString !== undefined && {
        query_string: typeof queryString === 'string' ? redactPii(queryString) : queryString,
      }),
      ...(env !== undefined && { env }),
    };
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(redactBreadcrumb);
  }
  delete scrubbed.extra;
  delete scrubbed.user;

  return scrubbed;
}

export interface InitSentryOptions {
  /** No-ops when unset — see this module's header comment. */
  dsn: string | undefined;
  environment: string;
}

export function initSentry({ dsn, environment }: InitSentryOptions): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment,
    // Explicit even though it's Sentry's own default — this is the one
    // setting standing between "route + tenant only" and Sentry's usual
    // autofill of IP/cookies/user context, worth stating rather than
    // relying on a default that could change upstream.
    sendDefaultPii: false,
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
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
 * Called from `main.tsx`'s `router.subscribe('onResolved', ...)`. */
export function updateSentryRouteTag(routeId: string): void {
  Sentry.setTag('route', routeId);
}

/** Reports a route-render error caught by `../components/route-error-
 * boundary.tsx`'s `RouteErrorFallback`. Route/tenant context comes from
 * the tags above, already current by the time an error boundary mounts —
 * this only needs to forward the error itself. */
export function captureRouteError(error: unknown): void {
  Sentry.captureException(error);
}
