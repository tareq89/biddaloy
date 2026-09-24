import { describe, expect, it } from 'vitest';

import { ChangeRequestState, PeriodSlotKind, RoutineState, SlotRecurrence } from './routines';

describe('RoutineState', () => {
  it('has exactly the DRAFT/REVIEW/PUBLISHED lifecycle', () => {
    expect(Object.values(RoutineState).sort()).toEqual(['DRAFT', 'PUBLISHED', 'REVIEW']);
  });
});

describe('PeriodSlotKind', () => {
  it('has exactly CLASS/BREAK', () => {
    expect(Object.values(PeriodSlotKind).sort()).toEqual(['BREAK', 'CLASS']);
  });
});

describe('SlotRecurrence', () => {
  it('has exactly WEEKLY/BIWEEKLY/MONTHLY', () => {
    expect(Object.values(SlotRecurrence).sort()).toEqual(['BIWEEKLY', 'MONTHLY', 'WEEKLY']);
  });
});

describe('ChangeRequestState', () => {
  it('has exactly OPEN/ACCEPTED/REJECTED', () => {
    expect(Object.values(ChangeRequestState).sort()).toEqual(['ACCEPTED', 'OPEN', 'REJECTED']);
  });
});
