import type { Request, Response } from 'express';

/**
 * Public, per-deploy values the SPA needs but cannot have baked into the
 * bundle (one image serves prod, staging and demo). Only public values go
 * here: this is served to anyone, no auth. A spec asserts the exact key list.
 */
export function buildRuntimeConfig(env: Record<string, string | undefined>) {
  return {
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? '',
    supportUrl: env.SUPPORT_CONTACT_URL ?? '',
    sentryDsn: env.SENTRY_DSN_WEB ?? '',
    sentryEnvironment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? '',
    sentryTracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    release: env.APP_VERSION ?? '',
    // [87 D8] the test inbox link, only where the sink is on
    messageSinkUrl: env.MESSAGE_SINK === 'mailpit' ? (env.MESSAGE_SINK_PUBLIC_URL ?? '') : '',
    // [88 U5, D9] the staging ribbon: "DEV" or "STAGING" plus its data date; empty on prod
    envBadge: env.ENV_BADGE ?? '',
    envBadgeDate: env.ENV_BADGE_DATE ?? '',
  };
}

// The JS line separators; written as char codes so the source has no raw ones.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** The script body. `<` (and the JS line separators) are escaped so no value can close the tag or the string. */
export function renderRuntimeConfig(env: Record<string, string | undefined>): string {
  const json = JSON.stringify(buildRuntimeConfig(env))
    .replace(/</g, '\\u003c')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029');
  return `window.__BIDDALOY_CONFIG__=${json};`;
}

/**
 * Plain express handler mounted in `main.ts` (like `buildSpaFallback`), not a
 * controller: it must exist in every NODE_ENV, outside the `/api` prefix.
 * Rule 1 (closed by default) does not apply: no tenant data, only public
 * config, so there is nothing to protect. Rule 14: `no-store`, so a
 * deploy's new values are never hidden by a cache.
 */
export function runtimeConfigHandler(env: Record<string, string | undefined> = process.env) {
  const body = renderRuntimeConfig(env); // rendered once at boot
  return function runtimeConfig(_req: Request, res: Response): void {
    res.type('application/javascript; charset=utf-8').set('Cache-Control', 'no-store').send(body);
  };
}
