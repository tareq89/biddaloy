/**
 * [16.7.2] The school day's timezone. Fixed for now (Bangladesh-only
 * tenants) — a future multi-region rollout would read this per-tenant
 * instead, the same way `attendance-policy.util.ts`'s `localToday` takes
 * a `timezone` argument rather than a constant.
 */
export const SCHOOL_TZ = 'Asia/Dhaka';

/**
 * Today's calendar date, `'YYYY-MM-DD'`, in `SCHOOL_TZ` — independent of
 * whatever timezone the server host itself runs in. Same `en-CA` trick as
 * `attendance-policy.util.ts`'s `localDate`.
 */
export function todayInSchoolTz(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ }).format(new Date());
}
