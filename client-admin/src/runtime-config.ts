/** Public per-deploy values the server renders at `/runtime-config.js` (`server/src/runtime-config.ts`). */
export interface RuntimeConfig {
  turnstileSiteKey: string;
  supportUrl: string;
  sentryDsn: string;
  sentryEnvironment: string;
  sentryTracesSampleRate: number;
  release: string;
  /** Test inbox URL; empty on prod, so no notice there. */
  messageSinkUrl: string;
  /** "DEV", "STAGING" or empty (prod: no ribbon). */
  envBadge: string;
  /** ISO date the staging data was copied; shown beside STAGING. */
  envBadgeDate: string;
}

declare global {
  interface Window {
    __BIDDALOY_CONFIG__?: Partial<RuntimeConfig>;
  }
}

/**
 * Read at call time, not import time. A missing global (vite dev server, a
 * failed script load) falls back to empty values: no captcha, no Sentry, no
 * support link. That is the fail-open case.
 */
export function runtimeConfig(): RuntimeConfig {
  const c = window.__BIDDALOY_CONFIG__ ?? {};
  return {
    turnstileSiteKey: c.turnstileSiteKey ?? '',
    supportUrl: c.supportUrl ?? '',
    sentryDsn: c.sentryDsn ?? '',
    sentryEnvironment: c.sentryEnvironment ?? '',
    sentryTracesSampleRate: c.sentryTracesSampleRate ?? 0.1,
    release: c.release ?? '',
    messageSinkUrl: c.messageSinkUrl ?? '',
    envBadge: c.envBadge ?? '',
    envBadgeDate: c.envBadgeDate ?? '',
  };
}
