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

/**
 * Tighter than `STRICT_RATE_LIMIT` — applied to #8.7.12's provider
 * connection test (`POST /schools/:id/settings/test`), the one endpoint in
 * this codebase that makes a real outbound call to a third-party API
 * (Meta Graph, an SMTP server, an SMS gateway) on every request rather
 * than just doing more DB work. A caller hammering it either burns a
 * tenant's own SMTP/API quota or, worse, becomes a vector for probing a
 * third party's auth endpoint.
 */
export const PROVIDER_TEST_RATE_LIMIT: RateLimitTierOptions = { limit: 3, ttl: 60_000 };

/**
 * Applied to `GET`/`PATCH /schools/:id/settings` — a credential-bearing
 * read/write (a masked hint is still information about a school's
 * provider accounts), but not an "expensive" endpoint in
 * `STRICT_RATE_LIMIT`'s sense: it's a single-row jsonb read/write, and
 * #8.7.13's dashboard saves one section (region/SMS/WhatsApp/email/
 * Messenger) at a time rather than the whole page at once, so a normal
 * "paste five credentials from a password manager" setup session is five
 * PATCHes in quick succession — `STRICT_RATE_LIMIT`'s 5/60s sits right on
 * that boundary and one typo-and-retry tips it over. This tier keeps a
 * meaningful brake on enumerating a credential-bearing read while leaving
 * room for a normal setup session.
 */
export const SETTINGS_RATE_LIMIT: RateLimitTierOptions = { limit: 20, ttl: 60_000 };
