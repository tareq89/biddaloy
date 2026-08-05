export interface RateLimitTierOptions {
  limit: number;
  ttl: number;
}

/**
 * The generous, globally-applied default tier (see app.module.ts). Configurable
 * by env so it can be tuned without a redeploy; unset falls back to 100
 * requests per 60s per tracked identity (authenticated user, else IP — see
 * common/rate-limit/rate-limit-tracker.ts).
 *
 * The stricter per-route tier used on expensive endpoints (bulk upload, fee
 * generation, bulk reminders, invoice creation) is applied via `@Throttle()`
 * decorators with literal values instead: `@Throttle()` arguments are
 * evaluated at module-import time, before ConfigModule's dotenv loading runs,
 * so env-driven numbers there would silently miss `.env`-file overrides in
 * local dev (only already-present process env vars would take effect).
 */
export function resolveDefaultRateLimit(
  limitEnv: string | undefined,
  ttlMsEnv: string | undefined,
): RateLimitTierOptions {
  return {
    limit: limitEnv ? Number(limitEnv) : 100,
    ttl: ttlMsEnv ? Number(ttlMsEnv) : 60_000,
  };
}

/**
 * Applied per-route via `@Throttle({ default: STRICT_RATE_LIMIT })` on the
 * genuinely expensive endpoints (bulk upload, fee generation, bulk
 * reminders, invoice creation) — these do real work per request and are
 * the actual abuse targets, unlike a typical CRUD read/write.
 */
export const STRICT_RATE_LIMIT: RateLimitTierOptions = { limit: 5, ttl: 60_000 };
