import { describe, it, expect } from 'vitest';
import { isDue, nextRunDates, periodFor } from './recurrence.util';
import type { RecurringScheduleRule } from './entities/recurring-schedule.entity';

describe('recurrence.util [16.7.1]', () => {
  describe('periodFor', () => {
    it("MONTHLY returns the 1st of the given date's month", () => {
      const rule: RecurringScheduleRule = { kind: 'MONTHLY', day_of_month: 15 };
      expect(periodFor('2026-03-17', rule)).toBe('2026-03-01');
    });

    it("WEEKLY returns the Monday of the given date's week", () => {
      const rule: RecurringScheduleRule = { kind: 'WEEKLY', weekdays: [3] };
      // 2026-03-19 is a Thursday.
      expect(periodFor('2026-03-19', rule)).toBe('2026-03-16');
    });

    it('WEEKLY on a Monday returns itself', () => {
      const rule: RecurringScheduleRule = { kind: 'WEEKLY', weekdays: [1] };
      expect(periodFor('2026-03-16', rule)).toBe('2026-03-16');
    });
  });

  describe('isDue — MONTHLY', () => {
    it('fires on the exact day_of_month', () => {
      const rule: RecurringScheduleRule = { kind: 'MONTHLY', day_of_month: 5 };
      expect(isDue(rule, '2026-04-05')).toBe(true);
      expect(isDue(rule, '2026-04-06')).toBe(false);
    });

    it("'LAST' fires on the month's final day", () => {
      const rule: RecurringScheduleRule = { kind: 'MONTHLY', day_of_month: 'LAST' };
      expect(isDue(rule, '2026-04-30')).toBe(true);
      expect(isDue(rule, '2026-04-29')).toBe(false);
    });

    it("'LAST' is Feb-safe in both a common and a leap year", () => {
      const rule: RecurringScheduleRule = { kind: 'MONTHLY', day_of_month: 'LAST' };
      expect(isDue(rule, '2026-02-28')).toBe(true); // 2026: common year
      expect(isDue(rule, '2028-02-29')).toBe(true); // 2028: leap year
      expect(isDue(rule, '2028-02-28')).toBe(false);
    });

    it("a day_of_month beyond a short month fires on that month's last day", () => {
      // day_of_month: 30 in February — fires on Feb 28 (or 29), not never.
      const rule: RecurringScheduleRule = { kind: 'MONTHLY', day_of_month: 30 };
      expect(isDue(rule, '2026-02-28')).toBe(true);
      expect(isDue(rule, '2026-04-30')).toBe(true);
    });
  });

  describe('isDue — WEEKLY', () => {
    it('fires on every listed ISO weekday', () => {
      const rule: RecurringScheduleRule = { kind: 'WEEKLY', weekdays: [1, 5] }; // Mon, Fri
      expect(isDue(rule, '2026-03-16')).toBe(true); // Monday
      expect(isDue(rule, '2026-03-20')).toBe(true); // Friday
      expect(isDue(rule, '2026-03-17')).toBe(false); // Tuesday
    });

    it('treats Sunday as ISO weekday 7, not 0', () => {
      const rule: RecurringScheduleRule = { kind: 'WEEKLY', weekdays: [7] };
      expect(isDue(rule, '2026-03-22')).toBe(true); // a Sunday
    });
  });

  describe('nextRunDates', () => {
    it('returns the requested count of upcoming MONTHLY dates in order', () => {
      const rule: RecurringScheduleRule = { kind: 'MONTHLY', day_of_month: 1 };
      expect(nextRunDates(rule, '2026-01-15', 3)).toEqual([
        '2026-02-01',
        '2026-03-01',
        '2026-04-01',
      ]);
    });

    it('includes `from` itself when it is already due', () => {
      const rule: RecurringScheduleRule = { kind: 'WEEKLY', weekdays: [1] };
      expect(nextRunDates(rule, '2026-03-16', 1)).toEqual(['2026-03-16']);
    });

    it("carries a 'LAST' MONTHLY rule correctly across Feb", () => {
      const rule: RecurringScheduleRule = { kind: 'MONTHLY', day_of_month: 'LAST' };
      expect(nextRunDates(rule, '2026-01-01', 2)).toEqual(['2026-01-31', '2026-02-28']);
    });
  });
});
