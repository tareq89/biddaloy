import type { HelmetOptions } from 'helmet';

/**
 * Explicit, tight CSP tailored to this app: the built SPAs load only
 * same-origin scripts/styles (Vite's content-hashed assets), the API only
 * ever talks to itself, and there's no inline script/style anywhere in the
 * production build. Deliberately not using helmet's own CSP defaults, which
 * are broader (e.g. `style-src ... 'unsafe-inline'`, `font-src ... https:`)
 * than this app actually needs — verify any change here by loading each SPA
 * with the browser console open and confirming zero CSP violations.
 *
 * One third-party origin is allowed: Cloudflare Turnstile, the captcha on the
 * public `/register` form ([13.5.1]). It loads a script and renders its
 * challenge in an iframe, both from `TURNSTILE_ORIGIN`.
 */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** The browser Sentry SDK posts to its DSN's origin; empty or unparseable = nothing added. */
function sentryOrigin(dsn: string | undefined): string[] {
  try {
    return dsn ? [new URL(dsn).origin] : [];
  } catch {
    return [];
  }
}

export function buildHelmetOptions(
  nodeEnv: string | undefined,
  sentryDsnWeb?: string,
): HelmetOptions {
  const isProduction = nodeEnv === 'production';
  const sentry = sentryOrigin(sentryDsnWeb);

  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameSrc: [TURNSTILE_ORIGIN],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", TURNSTILE_ORIGIN],
        styleSrc: ["'self'"],
        // Only when SENTRY_DSN_WEB is set (runtime-config.ts); otherwise default-src 'self'.
        ...(sentry.length ? { connectSrc: ["'self'", ...sentry] } : {}),
        // Forcing http->https upgrades makes sense once TLS is real
        // (production, behind the nginx from #32) but actively breaks local
        // dev, where the app is served over plain http://localhost.
        ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Only enable once a deployment is guaranteed to be serving valid TLS
    // (#32) — a browser that caches HSTS for a domain not actually serving
    // valid TLS locks users out entirely.
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    // noSniff and hidePoweredBy default to on. xXssProtection defaults to
    // sending "X-XSS-Protection: 0" — the modern recommendation, since the
    // header's legacy filter behavior is deprecated and actively buggy in
    // browsers that still honor it. CSP is the real XSS control here, not
    // this header; left at helmet's default rather than disabling the
    // header outright (helmet's own docs call that "not recommended").
  };
}
