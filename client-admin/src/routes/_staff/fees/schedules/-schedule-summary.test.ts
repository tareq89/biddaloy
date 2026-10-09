import type { RecurringSchedule } from '@biddaloy/ui/hooks';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { describe, expect, it } from 'vitest';

import { audienceSummary, lastBilledLabel, nextRunDate, ruleSummary } from './-schedule-summary';

// A stand-in `t` that renders the real Bangla/English wording for the keys under test.
const BN: Record<string, string> = {
  'schedules.ruleWeekly': 'প্রতি {{days}}',
  'schedules.ruleMonthly': 'প্রতি মাসের {{day}} তারিখে',
  'schedules.someProgram': 'একটি প্রোগ্রাম',
  'schedules.wholeSchool': 'পুরো বিদ্যালয়',
  'schedules.neverBilled': 'এখনো হয়নি',
  'weekdays.7': 'রবিবার',
  'weekdays.3': 'বুধবার',
};
const t = ((key: string, options: Record<string, string> = {}) =>
  (BN[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => options[name] ?? '')) as never;

function schedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    id: 'schedule-1',
    name: 'Monthly tuition',
    academic_year_id: 'year-1',
    fee_structure_ids: ['fee-1'],
    audience: { enrollment_status: 'ACTIVE' },
    rule: { kind: 'MONTHLY', day_of_month: 1 },
    period_type: 'MONTH',
    due_days_after_period_start: 7,
    starts_on: '2026-01-01',
    ends_on: '',
    notify_families: false,
    is_active: true,
    last_run_period: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('schedule summaries', () => {
  it('joins the weekday names of a weekly rule with a conjunction', () => {
    const weekly = schedule({ rule: { kind: 'WEEKLY', weekdays: [7, 3] } });
    expect(ruleSummary(weekly, t, REGION_BD_EN, 'bn')).toBe('প্রতি রবিবার এবং বুধবার');
  });

  it('writes the monthly day in tenant numerals', () => {
    expect(ruleSummary(schedule(), t, REGION_BD_EN, 'bn')).toBe('প্রতি মাসের 1 তারিখে');
  });

  it('names an unresolved program as "a program" and keeps the whole-school default', () => {
    const scoped = schedule({
      audience: { enrollment_status: 'ACTIVE', program_id: 'program-gone' },
    });
    expect(audienceSummary(scoped, t, new Map(), new Map(), new Map())).toBe(
      'পুরো বিদ্যালয় · একটি প্রোগ্রাম',
    );
  });

  it('names a resolved program in the audience', () => {
    const scoped = schedule({
      audience: { enrollment_status: 'ACTIVE', program_id: 'program-1' },
    });
    expect(audienceSummary(scoped, t, new Map(), new Map(), new Map([['program-1', 'Hifz']]))).toBe(
      'পুরো বিদ্যালয় · Hifz',
    );
  });

  it('says "not yet" when a rule never ran, a month name for monthly and a date for weekly', () => {
    expect(lastBilledLabel(schedule(), t, REGION_BD_EN)).toBe('এখনো হয়নি');
    expect(lastBilledLabel(schedule({ last_run_period: '2026-10-01' }), t, REGION_BD_EN)).toBe(
      'October 2026',
    );
    expect(
      lastBilledLabel(
        schedule({ rule: { kind: 'WEEKLY', weekdays: [1] }, last_run_period: '2026-10-05' }),
        t,
        REGION_BD_EN,
      ),
    ).toBe('5th October, 2026');
  });

  it('computes the next monthly run from the rule and starts_on', () => {
    const next = nextRunDate(
      schedule({ starts_on: '2026-01-01' }),
      new Date('2026-10-05T00:00:00Z'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-11-01');
    // Inactive rules have no next run.
    expect(
      nextRunDate(schedule({ is_active: false }), new Date('2026-10-05T00:00:00Z')),
    ).toBeNull();
  });
});
