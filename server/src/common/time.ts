/**
 * [16.7.2] The school day's timezone. Fixed for now (Bangladesh-only
 * tenants) — a future multi-region rollout would read this per-tenant
 * instead; every helper below already takes a `timezone` argument.
 */
export const SCHOOL_TZ = 'Asia/Dhaka';

/**
 * Calendar day `instant` falls on in `timezone`, as `'YYYY-MM-DD'`.
 * `en-CA` formats dates as `YYYY-MM-DD` directly. E.g. `2026-09-04T19:00Z`
 * is already the 5th in Asia/Dhaka (UTC+6).
 */
export function localDate(instant: Date, timezone: string = SCHOOL_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(instant);
}

/** Today in `timezone`, as `'YYYY-MM-DD'` — independent of the host's own timezone. */
export function localToday(timezone: string = SCHOOL_TZ): string {
  return localDate(new Date(), timezone);
}

/** Today's calendar date in `SCHOOL_TZ`, as `'YYYY-MM-DD'`. */
export function todayInSchoolTz(): string {
  return localToday(SCHOOL_TZ);
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
  const nextDay = new Date(`${dateIso}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return new Date(startOfLocalDay(nextDay.toISOString().slice(0, 10), timezone).getTime() - 1);
}
