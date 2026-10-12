/**
 * [16.7.2] The clock for platform-wide cron triggers (e.g. the 00:30 fees-daily
 * run). `DEFAULT_REGION_SETTINGS` carries its own 'Asia/Dhaka' literal. Code that knows its tenant
 * must use `SchoolsService.todayFor(tenantId)` for "today", not this.
 * // ponytail: remaining todayInSchoolTz() callers (print jobs, application reports, student-lifecycle DTO validators, promotions, fines) still use Dhaka; move each to todayFor when a non-Bangladesh school is onboarded.
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
