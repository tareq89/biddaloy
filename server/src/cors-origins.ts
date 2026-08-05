/**
 * `CORS_ORIGINS` is a comma-separated allowlist. When unset — or set to an
 * empty string, which env.validation.ts's `@IsOptional()` also lets through —
 * dev gets the Vite dev server origin and production gets no cross-origin
 * access. The three SPAs are served same-origin by this app (see main.ts)
 * until one moves to its own domain/CDN, at which point CORS_ORIGINS must be
 * set explicitly.
 */
export function resolveCorsOrigins(
  corsOriginsEnv: string | undefined,
  nodeEnv: string | undefined,
): string[] {
  if (corsOriginsEnv) {
    return corsOriginsEnv
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return nodeEnv === 'production' ? [] : ['http://localhost:5173'];
}

/**
 * The full CORS configuration used at boot (main.ts). Also used directly by
 * cors.e2e-spec.ts so the test exercises the actual production wiring rather
 * than a hand-copied duplicate that could drift from it.
 */
export function buildCorsOptions(corsOriginsEnv: string | undefined, nodeEnv: string | undefined) {
  return {
    origin: resolveCorsOrigins(corsOriginsEnv, nodeEnv),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // X-Tenant-ID and X-Role are read by ContextGuard on every authenticated
    // request (auth/guards/context.guard.ts) and must survive preflight.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Role'],
  };
}
