import { AttendanceStatus } from '@biddaloy/shared';
import type { AttendancePolicySettings, TenantSettings } from '@biddaloy/shared';

/**
 * Pure functions for the attendance policy math — no database, no NestJS DI,
 * easy to unit test. [9.3]'s write path and [9.5]'s device check-in path
 * (`classifyCheckIn`) both depend on this being the one definition of
 * "today", "late", and "weekly off" for a tenant.
 *
 * Every "today"/"late" comparison in the attendance module must go through
 * here rather than a bare `new Date()` comparison — the whole point of this
 * file is that a school's local calendar day can differ from the server's
 * UTC day (Asia/Dhaka is UTC+6, so `2026-09-04T19:00Z` is already the 5th
 * locally).
 */

/**
 * A tenant's resolved attendance policy. `settings` must already be the
 * output of `SchoolsService.getResolvedSettings()` (or
 * `resolveTenantSettings()` directly) — that function guarantees `attendance`
 * is populated by merging over `DEFAULT_ATTENDANCE_SETTINGS`, so this never
 * has to re-implement that merge. Throws if handed a raw, unresolved
 * settings blob instead, rather than silently returning `undefined`-shaped
 * data.
 */
export function resolveAttendancePolicy(settings: TenantSettings): AttendancePolicySettings {
  if (!settings.attendance) {
    throw new Error(
      'TenantSettings has no resolved attendance policy — pass the result of ' +
        "SchoolsService.getResolvedSettings(), not a school's raw settings column.",
    );
  }
  return settings.attendance;
}

export type SpecialTiming = NonNullable<AttendancePolicySettings['specialTimings']>[number];

/**
 * The special timing covering `dateIso` (inclusive range) for `shiftId`: the
 * shift's own entry wins, else the all-shifts (`shiftId: null`) entry, else
 * `null`. The all-shifts entry stands in for the tenant-wide times only, so a
 * shift with its own `shiftTimes` row ignores it — a day shift at 12:15 must
 * not inherit a morning-clock Ramadan cut-off. Pure.
 */
export function specialTimingOn(
  policy: AttendancePolicySettings,
  shiftId: string | null | undefined,
  dateIso: string,
): SpecialTiming | null {
  const covering = (policy.specialTimings ?? []).filter(
    (t) => t.from <= dateIso && dateIso <= t.to,
  );
  const own = shiftId ? covering.find((t) => t.shiftId === shiftId) : undefined;
  if (own) return own;
  if (shiftId && policy.shiftTimes?.some((s) => s.shiftId === shiftId)) return null;
  return covering.find((t) => t.shiftId === null) ?? null;
}

/**
 * The policy with `shiftId`'s late/absent times applied, then — when `dateIso`
 * is given and a special timing covers it — that timing's cut-offs on top.
 * Returns `policy` unchanged when neither applies. Pure.
 */
export function policyForShift(
  policy: AttendancePolicySettings,
  shiftId: string | null | undefined,
  dateIso?: string,
): AttendancePolicySettings {
  const entry = shiftId ? policy.shiftTimes?.find((s) => s.shiftId === shiftId) : undefined;
  const base = entry
    ? { ...policy, lateAfter: entry.lateAfter, absentAfter: entry.absentAfter }
    : policy;
  const special = dateIso ? specialTimingOn(policy, shiftId, dateIso) : null;
  return special
    ? { ...base, lateAfter: special.lateAfter, absentAfter: special.absentAfter }
    : base;
}

/**
 * Start/end of one period on `dateIso`: the covering special timing's row for
 * its `sequence` (`HH:mm` + `:00`, matching the `time` column), else the
 * period's own times. Pure.
 */
export function periodTimesOn(
  policy: AttendancePolicySettings,
  period: { shift_id: string; sequence: number; starts_at: string; ends_at: string },
  dateIso: string,
): { starts_at: string; ends_at: string } {
  const row = specialTimingOn(policy, period.shift_id, dateIso)?.periods.find(
    (p) => p.sequence === period.sequence,
  );
  return row
    ? { starts_at: `${row.startsAt}:00`, ends_at: `${row.endsAt}:00` }
    : { starts_at: period.starts_at, ends_at: period.ends_at };
}

/** Days since the Unix epoch for a plain `'YYYY-MM-DD'` calendar date, computed
 * at UTC midnight. Calendar dates carry no timezone of their own — `date`
 * columns and `dateIso` strings throughout this module are already "the 4th
 * of September", not an instant — so UTC midnight is just an arbitrary but
 * consistent anchor for arithmetic, not a timezone conversion. */
function toEpochDay(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
}

/**
 * Whether `dateIso` falls on one of the tenant's configured weekly off days
 * (`0` = Sunday .. `6` = Saturday, matching `AttendancePolicySettings.weeklyOffDays`).
 * Bangladesh's default is Friday (`[5]`). Dates before a `weeklyOffHistory`
 * entry's `until` use that entry's days (history is ascending by `until`).
 */
export function isWeeklyOff(dateIso: string, policy: AttendancePolicySettings): boolean {
  // [TIME-02] A date is judged by the off days in force on it: the earliest
  // history entry whose `until` is after the date, else the current days.
  const days =
    (policy.weeklyOffHistory ?? []).find((e) => dateIso < e.until)?.days ?? policy.weeklyOffDays;
  const epochDay = toEpochDay(dateIso);
  // 1970-01-01 (epoch day 0) was a Thursday (weekday 4). Offsetting by 4 and
  // taking mod 7 gives the ISO/JS weekday (0 = Sunday) without constructing a
  // `Date` object per call.
  const weekday = (((epochDay + 4) % 7) + 7) % 7;
  return days.includes(weekday);
}

export { localDate, localToday } from '../../common/time';

/** `HH:mm` in `timezone` right now (24h, so plain string comparison orders it). */
export function localTimeHHmm(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

/** `YYYY-MM-DD` plus `n` calendar days (negative goes back). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `aIso` to `bIso` (`bIso - aIso`). Positive when
 * `bIso` is later — e.g. `daysBetween(sessionDate, localToday(tz))` is the
 * "age" of a register: positive once the register's date is in the past. */
export function daysBetween(aIso: string, bIso: string): number {
  return toEpochDay(bIso) - toEpochDay(aIso);
}

function hhmmToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Minutes since local midnight, in `timezone`, for a given instant. */
function localMinutesSinceMidnight(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Classifies a single check-in instant against the tenant's `lateAfter`/
 * `absentAfter` policy. Shared by [9.3] (not called by any route in this
 * ticket — teachers submit an explicit status) and [9.5]'s device check-in
 * path, so both tickets agree on what "late" means. `dateIso` is accepted
 * (not used for the comparison itself, which is purely time-of-day) so a
 * future caller can validate that `occurredAt`, converted to `timezone`,
 * actually falls on `dateIso` rather than the adjacent calendar day near a
 * timezone boundary — [9.5]'s concern, not this ticket's.
 */
export function classifyCheckIn(
  occurredAt: Date,
  _dateIso: string,
  policy: AttendancePolicySettings,
  timezone: string,
): { status: AttendanceStatus; minutesLate: number | null } {
  const minutesSinceMidnight = localMinutesSinceMidnight(occurredAt, timezone);
  const lateAfterMinutes = hhmmToMinutes(policy.lateAfter);
  const absentAfterMinutes = hhmmToMinutes(policy.absentAfter);

  if (minutesSinceMidnight <= lateAfterMinutes) {
    return { status: AttendanceStatus.PRESENT, minutesLate: null };
  }
  if (minutesSinceMidnight <= absentAfterMinutes) {
    return {
      status: AttendanceStatus.LATE,
      minutesLate: minutesSinceMidnight - lateAfterMinutes,
    };
  }
  return { status: AttendanceStatus.ABSENT, minutesLate: null };
}
