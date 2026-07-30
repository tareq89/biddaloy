/**
 * `CORS_ORIGINS` is a comma-separated allowlist. When unset, dev gets the
 * Vite dev server origin and production gets no cross-origin access — the
 * three SPAs are served same-origin by this app (see main.ts) until one
 * moves to its own domain/CDN, at which point CORS_ORIGINS must be set
 * explicitly.
 */
export function resolveCorsOrigins(corsOriginsEnv: string | undefined, nodeEnv: string | undefined): string[] {
  if (corsOriginsEnv) {
    return corsOriginsEnv
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return nodeEnv === "production" ? [] : ["http://localhost:5173"];
}
