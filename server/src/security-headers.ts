import type { HelmetOptions } from 'helmet';

/**
 * Explicit, tight CSP tailored to this app: the built SPAs load only
 * same-origin scripts/styles (Vite's content-hashed assets), the API only
 * ever talks to itself, and there's no inline script/style anywhere in the
 * production build. Deliberately not using helmet's own CSP defaults, which
 * are broader (e.g. `style-src ... 'unsafe-inline'`, `font-src ... https:`)
 * than this app actually needs — verify any change here by loading each SPA
 * with the browser console open and confirming zero CSP violations.
 */
export function buildHelmetOptions(nodeEnv: string | undefined): HelmetOptions {
  const isProduction = nodeEnv === 'production';

  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
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
