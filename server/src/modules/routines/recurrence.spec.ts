import { describe, it, expect } from 'vitest';
import { SlotRecurrence } from '@biddaloy/shared';
import { occursOn, RecurrenceSlotLike } from './recurrence';

function slot(overrides: Partial<RecurrenceSlotLike> = {}): RecurrenceSlotLike {
  return {
    weekday: 1, // Monday
    recurrence: SlotRecurrence.WEEKLY,
    recurrence_offset: 0,
    ...overrides,
  };
}

const YEAR_START = '2026-01-04'; // Sunday

describe('occursOn', () => {
  describe('WEEKLY', () => {
    it('matches every occurrence of the weekday across a month', () => {
      const s = slot({ recurrence: SlotRecurrence.WEEKLY });
      for (const date of ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']) {
        expect(occursOn(s, date, YEAR_START)).toBe(true);
      }
    });

    it('never matches a different weekday', () => {
      const s = slot({ recurrence: SlotRecurrence.WEEKLY });
      expect(occursOn(s, '2026-01-06', YEAR_START)).toBe(false); // Tuesday
    });
  });

  describe('BIWEEKLY', () => {
    it('matches only the week whose parity equals recurrence_offset (0)', () => {
      const s = slot({ recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 });
      expect(occursOn(s, '2026-01-05', YEAR_START)).toBe(true); // week index 0
      expect(occursOn(s, '2026-01-12', YEAR_START)).toBe(false); // week index 1
      expect(occursOn(s, '2026-01-19', YEAR_START)).toBe(true); // week index 2
    });

    it('matches the other parity when recurrence_offset is 1', () => {
      const s = slot({ recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 1 });
      expect(occursOn(s, '2026-01-05', YEAR_START)).toBe(false);
      expect(occursOn(s, '2026-01-12', YEAR_START)).toBe(true);
      expect(occursOn(s, '2026-01-19', YEAR_START)).toBe(false);
    });

    it('week index is anchored to the academic year start, not the ISO week number', () => {
      const s = slot({ recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 });
      // A different academic year start shifts which Mondays are "week 0".
      expect(occursOn(s, '2026-01-05', '2025-12-28')).toBe(false);
    });
  });

  describe('MONTHLY', () => {
    it('matches the 1st occurrence', () => {
      const s = slot({ recurrence: SlotRecurrence.MONTHLY, recurrence_offset: 1 });
      expect(occursOn(s, '2026-01-05', YEAR_START)).toBe(true);
      expect(occursOn(s, '2026-01-12', YEAR_START)).toBe(false);
    });

    it('matches the 2nd occurrence', () => {
      const s = slot({ recurrence: SlotRecurrence.MONTHLY, recurrence_offset: 2 });
      expect(occursOn(s, '2026-01-12', YEAR_START)).toBe(true);
      expect(occursOn(s, '2026-01-05', YEAR_START)).toBe(false);
    });

    it('matches the last occurrence via offset -1', () => {
      const s = slot({ recurrence: SlotRecurrence.MONTHLY, recurrence_offset: -1 });
      expect(occursOn(s, '2026-01-26', YEAR_START)).toBe(true); // last Monday in Jan 2026
      expect(occursOn(s, '2026-01-19', YEAR_START)).toBe(false);
    });

    it('never matches a 5th occurrence that does not exist in the month', () => {
      const s = slot({ recurrence: SlotRecurrence.MONTHLY, recurrence_offset: 5 });
      // January 2026 has only 4 Mondays (5, 12, 19, 26).
      for (const date of ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']) {
        expect(occursOn(s, date, YEAR_START)).toBe(false);
      }
    });
  });
});
