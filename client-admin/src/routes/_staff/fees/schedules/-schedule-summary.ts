/**
 * Plain-language summaries of a `RecurringSchedule` for the list and the detail page
 * (`index.tsx`, `$id.tsx`): who is billed, when, the next run and the last one. The "next run"
 * is still computed on the client — the server has no such field.
 */
import type { MonthlyRuleDay, RecurringSchedule, Weekday } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, formatMonth, formatNumber } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';

type FeesT = TFunction<'fees', undefined>;

/** `rule.weekdays` are ISO weekday numbers (1 = Monday .. 7 = Sunday), so they have to be turned
 * into names — joining the raw array rendered "Every 1, 4". */
export function ruleSummary(
  schedule: RecurringSchedule,
  t: FeesT,
  config: RegionConfig,
  language: string,
): string {
  if (schedule.rule.kind === 'MONTHLY') {
    const day = schedule.rule.day_of_month;
    return day === 'LAST'
      ? t('schedules.ruleMonthlyLast')
      : t('schedules.ruleMonthly', { day: formatNumber(day, config) });
  }
  const names = (schedule.rule.weekdays ?? []).map((day) =>
    t(`weekdays.${day}`, { ns: 'common', defaultValue: String(day) }),
  );
  const days = new Intl.ListFormat(language, { type: 'conjunction' }).format(names);
  return t('schedules.ruleWeekly', { days });
}

/** `classesById`/`sectionsById`/`programsById` resolve the audience ids into real names — without
 * them, a class-scoped schedule produced an empty `parts` and fell through to the "whole school"
 * default, wrongly labeling a scoped billing audience as unscoped. The "active students only" rule
 * is always true (`enrollment_status` accepts only `ACTIVE`), so the page subtitle says it once. */
export function audienceSummary(
  schedule: RecurringSchedule,
  t: FeesT,
  classesById: Map<string, string>,
  sectionsById: Map<string, string>,
  programsById: Map<string, string>,
): string {
  const { class_id, section_id, program_id } = schedule.audience;
  const parts: string[] = [];
  // `RecurringScheduleAudienceDto` allows `section_id` without `class_id`, so branch on either.
  if (class_id || section_id) {
    const className = class_id
      ? (classesById.get(class_id) ?? t('schedules.unknownClass'))
      : t('schedules.unknownClass');
    parts.push(
      section_id
        ? `${className} · ${sectionsById.get(section_id) ?? t('schedules.unknownSection')}`
        : className,
    );
  } else {
    parts.push(t('schedules.wholeSchool'));
  }
  if (program_id) parts.push(programsById.get(program_id) ?? t('schedules.someProgram'));
  return parts.join(' · ');
}

const DHAKA_OFFSET_MS = 6 * 60 * 60_000;

/** Same "shift, then read UTC fields" trick `reports/collections.tsx`'s `dhakaNow` uses, so "next
 * run" never depends on the machine's own timezone. */
export function dhakaNow(): Date {
  return new Date(Date.now() + DHAKA_OFFSET_MS);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDateOnly(value: string): Date {
  // `starts_on`/`ends_on` are `YYYY-MM-DD` — parsed as UTC midnight so comparisons against
  // `dhakaNow()`'s UTC-shifted clock line up.
  return new Date(`${value}T00:00:00.000Z`);
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function resolveMonthlyDay(year: number, month: number, day: MonthlyRuleDay): Date {
  const lastDay = daysInUtcMonth(year, month);
  const resolved = day === 'LAST' ? lastDay : Math.min(day, lastDay);
  return new Date(Date.UTC(year, month, resolved));
}

function nextMonthlyOccurrence(from: Date, day: MonthlyRuleDay): Date {
  const today = startOfUtcDay(from);
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth();
  let candidate = resolveMonthlyDay(year, month, day);
  if (candidate < today) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    candidate = resolveMonthlyDay(year, month, day);
  }
  return candidate;
}

/** ISO weekday (1 = Monday .. 7 = Sunday) -> JS `getUTCDay()` (0 = Sunday .. 6 = Saturday). Only
 * Sunday differs, hence the modulo. */
function isoWeekdayToJsDay(day: Weekday): number {
  return day % 7;
}

function nextWeeklyOccurrence(from: Date, weekdays: Weekday[]): Date | null {
  if (weekdays.length === 0) return null;
  const target = new Set(weekdays.map(isoWeekdayToJsDay));
  const today = startOfUtcDay(from);
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(today.getTime() + offset * 86_400_000);
    if (target.has(candidate.getUTCDay())) return candidate;
  }
  return null;
}

/** Client-side "next run" — the period this schedule will next fire on, computed from its
 * rule/starts_on/ends_on, same Dhaka-arithmetic convention `reports/collections.tsx` uses.
 * Inactive schedules, or a next occurrence past `ends_on`, have no next run. */
export function nextRunDate(schedule: RecurringSchedule, now: Date): Date | null {
  if (!schedule.is_active) return null;
  const startsOn = parseDateOnly(schedule.starts_on);
  const from = now > startsOn ? now : startsOn;
  const candidate =
    schedule.rule.kind === 'MONTHLY'
      ? nextMonthlyOccurrence(from, schedule.rule.day_of_month ?? 1)
      : nextWeeklyOccurrence(from, schedule.rule.weekdays ?? []);
  if (!candidate) return null;
  if (schedule.ends_on && candidate > parseDateOnly(schedule.ends_on)) return null;
  return candidate;
}

/** "অক্টোবর ২০২৬" for a monthly rule, a long date for a weekly one, "Not yet" when it never ran. */
export function lastBilledLabel(
  schedule: RecurringSchedule,
  t: FeesT,
  config: RegionConfig,
): string {
  if (schedule.last_run_period === null) return t('schedules.neverBilled');
  return schedule.rule.kind === 'MONTHLY'
    ? formatMonth(schedule.last_run_period.slice(0, 7), config)
    : formatDate(schedule.last_run_period, config);
}
