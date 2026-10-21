/**
 * [16.7.2] The clock for platform-wide cron triggers (e.g. the 00:30 fees-daily
 * run). `DEFAULT_REGION_SETTINGS` carries its own 'Asia/Dhaka' literal. Code that knows its tenant
 * must use `SchoolsService.todayFor(tenantId)` for "today", not this.
 * // ponytail: remaining todayInSchoolTz() callers (print jobs, exam-cohort, application reports, student-lifecycle DTO validators, promotions, fines) still use Dhaka; move each to todayFor when a non-Bangladesh school is onboarded.
 */
export const SCHOOL_TZ = 'Asia/Dhaka';

/**
 * Today's calendar date, `'YYYY-MM-DD'`, in `SCHOOL_TZ` — independent of
 * whatever timezone the server host itself runs in. Same `en-CA` trick as
 * `attendance-policy.util.ts`'s `localDate`.
 */
export function todayInSchoolTz(): string {
  return localToday(SCHOOL_TZ);
}

/**
 * Calendar day `instant` falls on in `timezone`, as `'YYYY-MM-DD'`. `en-CA`
 * formats dates as `YYYY-MM-DD` directly. E.g. `2026-09-04T19:00Z` is already
 * the 5th in Asia/Dhaka (UTC+6).
 */
export function localDate(instant: Date, timezone: string = SCHOOL_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(instant);
}

/** Today in `timezone`, as `'YYYY-MM-DD'`. */
export function localToday(timezone: string = SCHOOL_TZ): string {
  return localDate(new Date(), timezone);
}

/** UTC instant at which calendar day `dateIso` starts in `timezone`. */
export function startOfLocalDay(dateIso: string, timezone: string = SCHOOL_TZ): Date {
  const utcMidnight = new Date(`${dateIso}T00:00:00Z`);
  const tzMs = new Date(utcMidnight.toLocaleString('en-US', { timeZone: timezone })).getTime();
  const utcMs = new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(utcMidnight.getTime() - (tzMs - utcMs));
}

/** Last millisecond of calendar day `dateIso` in `timezone`. */
export function endOfLocalDay(dateIso: string, timezone: string = SCHOOL_TZ): Date {
  const next = new Date(`${dateIso}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return new Date(startOfLocalDay(next.toISOString().slice(0, 10), timezone).getTime() - 1);
}
