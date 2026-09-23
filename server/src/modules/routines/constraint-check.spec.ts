import { describe, it, expect } from 'vitest';
import { PeriodSlotKind, SlotRecurrence } from '@biddaloy/shared';
import { checkSlot, recurrenceIntersects, dateRangesOverlap, SlotLike } from './constraint-check';

const CLASS_PERIOD = { id: 'period-1', kind: PeriodSlotKind.CLASS };
const BREAK_PERIOD = { id: 'period-break', kind: PeriodSlotKind.BREAK };

function slot(overrides: Partial<SlotLike> = {}): SlotLike {
  return {
    id: 'existing-1',
    section_id: 'section-1',
    period_slot_id: 'period-1',
    period_sequence: 0,
    weekday: 1,
    subject_id: 'subject-1',
    room_id: 'room-1',
    recurrence: SlotRecurrence.WEEKLY,
    recurrence_offset: 0,
    valid_from: '2026-01-01',
    valid_to: null,
    teacher_ids: ['teacher-1'],
    ...overrides,
  };
}

function candidate(overrides: Partial<SlotLike> = {}): SlotLike {
  return {
    section_id: 'section-2',
    period_slot_id: 'period-1',
    period_sequence: 0,
    weekday: 1,
    subject_id: 'subject-2',
    room_id: 'room-2',
    recurrence: SlotRecurrence.WEEKLY,
    recurrence_offset: 0,
    valid_from: '2026-01-01',
    valid_to: null,
    teacher_ids: ['teacher-2'],
    ...overrides,
  };
}

describe('recurrenceIntersects (D8)', () => {
  it('WEEKLY intersects WEEKLY', () => {
    expect(
      recurrenceIntersects(
        { recurrence: SlotRecurrence.WEEKLY, recurrence_offset: 0 },
        { recurrence: SlotRecurrence.WEEKLY, recurrence_offset: 0 },
      ),
    ).toBe(true);
  });

  it('BIWEEKLY same offset clashes', () => {
    expect(
      recurrenceIntersects(
        { recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 },
        { recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 },
      ),
    ).toBe(true);
  });

  it('BIWEEKLY different offsets do not clash', () => {
    expect(
      recurrenceIntersects(
        { recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 },
        { recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 1 },
      ),
    ).toBe(false);
  });

  it('WEEKLY always intersects BIWEEKLY (any offset)', () => {
    expect(
      recurrenceIntersects(
        { recurrence: SlotRecurrence.WEEKLY, recurrence_offset: 0 },
        { recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 1 },
      ),
    ).toBe(true);
  });

  it('MONTHLY always intersects WEEKLY', () => {
    expect(
      recurrenceIntersects(
        { recurrence: SlotRecurrence.MONTHLY, recurrence_offset: 0 },
        { recurrence: SlotRecurrence.WEEKLY, recurrence_offset: 0 },
      ),
    ).toBe(true);
  });

  it('MONTHLY always intersects BIWEEKLY', () => {
    expect(
      recurrenceIntersects(
        { recurrence: SlotRecurrence.MONTHLY, recurrence_offset: 0 },
        { recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 1 },
      ),
    ).toBe(true);
  });

  it('MONTHLY always intersects MONTHLY', () => {
    expect(
      recurrenceIntersects(
        { recurrence: SlotRecurrence.MONTHLY, recurrence_offset: 0 },
        { recurrence: SlotRecurrence.MONTHLY, recurrence_offset: 0 },
      ),
    ).toBe(true);
  });
});

describe('dateRangesOverlap', () => {
  it('overlaps when ranges intersect', () => {
    expect(
      dateRangesOverlap(
        { valid_from: '2026-01-01', valid_to: '2026-06-01' },
        { valid_from: '2026-03-01', valid_to: null },
      ),
    ).toBe(true);
  });

  it('does not overlap when one ends before the other begins', () => {
    expect(
      dateRangesOverlap(
        { valid_from: '2026-01-01', valid_to: '2026-03-01' },
        { valid_from: '2026-03-02', valid_to: null },
      ),
    ).toBe(false);
  });

  it('overlaps when one ends on the day the other begins (inclusive endpoints)', () => {
    expect(
      dateRangesOverlap(
        { valid_from: '2026-01-01', valid_to: '2026-03-01' },
        { valid_from: '2026-03-01', valid_to: null },
      ),
    ).toBe(true);
  });
});

describe('checkSlot — hard violations', () => {
  it('flags scheduling into a BREAK period slot', () => {
    const result = checkSlot(candidate(), [], BREAK_PERIOD, new Set(), {});
    expect(result.violations.map((v) => v.code)).toContain('BREAK_SLOT');
  });

  it('flags the same teacher double-booked at the same weekday/time', () => {
    const existing = [slot({ teacher_ids: ['teacher-x'] })];
    const c = candidate({ teacher_ids: ['teacher-x'] });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.map((v) => v.code)).toContain('TEACHER_DOUBLE_BOOKED');
  });

  it('does not flag teacher clash when effective dates do not overlap', () => {
    const existing = [
      slot({ teacher_ids: ['teacher-x'], valid_from: '2026-01-01', valid_to: '2026-03-01' }),
    ];
    const c = candidate({ teacher_ids: ['teacher-x'], valid_from: '2026-03-02', valid_to: null });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.map((v) => v.code)).not.toContain('TEACHER_DOUBLE_BOOKED');
  });

  it('flags the same section double-booked at the same weekday/time', () => {
    const existing = [slot({ section_id: 'section-shared' })];
    const c = candidate({ section_id: 'section-shared' });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.map((v) => v.code)).toContain('SECTION_DOUBLE_BOOKED');
  });

  it('flags the same room double-booked at the same weekday/time', () => {
    const existing = [slot({ room_id: 'room-shared' })];
    const c = candidate({ room_id: 'room-shared' });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.map((v) => v.code)).toContain('ROOM_DOUBLE_BOOKED');
  });

  it('does not flag a room clash when the candidate has no room assigned', () => {
    const existing = [slot({ room_id: null })];
    const c = candidate({ room_id: null });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.map((v) => v.code)).not.toContain('ROOM_DOUBLE_BOOKED');
  });

  it('flags a teacher exceeding maxPeriodsPerTeacherPerDay', () => {
    const existing = [
      slot({ id: 's1', period_slot_id: 'p1', weekday: 1, teacher_ids: ['t1'] }),
      slot({ id: 's2', period_slot_id: 'p2', weekday: 1, teacher_ids: ['t1'] }),
    ];
    const c = candidate({ weekday: 1, period_slot_id: 'p3', teacher_ids: ['t1'] });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {
      maxPeriodsPerTeacherPerDay: 2,
    });
    expect(result.violations.map((v) => v.code)).toContain('TEACHER_OVER_DAILY_LIMIT');
  });

  it('does not flag when under the daily period cap', () => {
    const existing = [slot({ id: 's1', period_slot_id: 'p1', weekday: 1, teacher_ids: ['t1'] })];
    const c = candidate({ weekday: 1, period_slot_id: 'p2', teacher_ids: ['t1'] });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {
      maxPeriodsPerTeacherPerDay: 2,
    });
    expect(result.violations.map((v) => v.code)).not.toContain('TEACHER_OVER_DAILY_LIMIT');
  });
});

describe('checkSlot — soft warnings', () => {
  it('warns when the teacher is not registered against the section/subject', () => {
    const c = candidate({ teacher_ids: ['teacher-unassigned'] });
    const result = checkSlot(c, [], CLASS_PERIOD, new Set(), {});
    expect(result.warnings.map((w) => w.code)).toContain('TEACHER_NOT_ASSIGNED');
    expect(result.violations).toHaveLength(0);
  });

  it('does not warn when the teacher is registered', () => {
    const c = candidate({ teacher_ids: ['teacher-assigned'] });
    const result = checkSlot(c, [], CLASS_PERIOD, new Set(['teacher-assigned']), {});
    expect(result.warnings.map((w) => w.code)).not.toContain('TEACHER_NOT_ASSIGNED');
  });

  it('warns on a consecutive-period run past maxConsecutivePeriods, without blocking', () => {
    const existing = [
      slot({ id: 's1', period_slot_id: 'p1', period_sequence: 0, weekday: 1, teacher_ids: ['t1'] }),
      slot({ id: 's2', period_slot_id: 'p2', period_sequence: 1, weekday: 1, teacher_ids: ['t1'] }),
    ];
    const c = candidate({
      period_slot_id: 'p3',
      period_sequence: 2,
      weekday: 1,
      teacher_ids: ['t1'],
    });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(['t1']), {
      maxConsecutivePeriods: 2,
    });
    expect(result.warnings.map((w) => w.code)).toContain('TEACHER_OVER_CONSECUTIVE_LIMIT');
    expect(result.violations).toHaveLength(0);
  });
});

describe('checkSlot — recurrence matrix (D8)', () => {
  const base = { section_id: 'sec-a', teacher_ids: ['t-shared'] };

  it('weekly x weekly on the same weekday: clash', () => {
    const existing = [slot({ ...base, recurrence: SlotRecurrence.WEEKLY })];
    const c = candidate({ ...base, recurrence: SlotRecurrence.WEEKLY });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('biweekly x biweekly, same offset: clash', () => {
    const existing = [slot({ ...base, recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 })];
    const c = candidate({ ...base, recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('biweekly x biweekly, different offsets: no clash', () => {
    const existing = [slot({ ...base, recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 0 })];
    const c = candidate({ ...base, recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 1 });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations).toHaveLength(0);
  });

  it('monthly x weekly: clash', () => {
    const existing = [slot({ ...base, recurrence: SlotRecurrence.MONTHLY })];
    const c = candidate({ ...base, recurrence: SlotRecurrence.WEEKLY });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('monthly x biweekly: clash', () => {
    const existing = [slot({ ...base, recurrence: SlotRecurrence.MONTHLY })];
    const c = candidate({ ...base, recurrence: SlotRecurrence.BIWEEKLY, recurrence_offset: 1 });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('different weekdays: never clash, regardless of recurrence', () => {
    const existing = [slot({ ...base, recurrence: SlotRecurrence.WEEKLY, weekday: 1 })];
    const c = candidate({ ...base, recurrence: SlotRecurrence.WEEKLY, weekday: 2 });
    const result = checkSlot(c, existing, CLASS_PERIOD, new Set(), {});
    expect(result.violations).toHaveLength(0);
  });
});
