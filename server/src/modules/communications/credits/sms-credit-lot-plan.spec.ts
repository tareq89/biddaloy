import { describe, it, expect } from 'vitest';
import { planDraw, planReturn, usableSum, type PlanLot } from './sms-credit-lot-plan';

const NOW = new Date('2026-06-01T00:00:00Z');
const lot = (id: string, remaining: number, expires: string | null, created = 0, debited = 0) =>
  ({
    id,
    remaining,
    debited_units: debited,
    expires_at: expires ? new Date(expires) : null,
    created_at: new Date(created),
  }) as PlanLot;

describe('planDraw', () => {
  it('takes the earliest expiry first', () => {
    const lots = [lot('late', 10, '2026-09-01T00:00:00Z'), lot('soon', 10, '2026-07-01T00:00:00Z')];
    expect(planDraw(lots, 4, NOW)).toEqual([{ lotId: 'soon', units: 4 }]);
  });

  it('puts a no-expiry lot last', () => {
    const lots = [lot('never', 10, null), lot('soon', 3, '2026-07-01T00:00:00Z')];
    expect(planDraw(lots, 5, NOW)).toEqual([
      { lotId: 'soon', units: 3 },
      { lotId: 'never', units: 2 },
    ]);
  });

  it('breaks ties by creation order', () => {
    const lots = [lot('b', 5, null, 2), lot('a', 5, null, 1)];
    expect(planDraw(lots, 6, NOW)).toEqual([
      { lotId: 'a', units: 5 },
      { lotId: 'b', units: 1 },
    ]);
  });

  it('skips expired and empty lots', () => {
    const lots = [
      lot('expired', 10, '2026-05-01T00:00:00Z'),
      lot('empty', 0, null),
      lot('ok', 5, null),
    ];
    expect(planDraw(lots, 5, NOW)).toEqual([{ lotId: 'ok', units: 5 }]);
    expect(planDraw(lots, 6, NOW)).toBeNull();
    expect(usableSum(lots, NOW)).toBe(5);
  });

  it('fits exactly and returns null when short', () => {
    const lots = [lot('a', 4, null), lot('b', 6, null, 1)];
    expect(planDraw(lots, 10, NOW)).toHaveLength(2);
    expect(planDraw(lots, 11, NOW)).toBeNull();
  });

  it('rejects non-positive and fractional units', () => {
    const lots = [lot('a', 4, null)];
    expect(planDraw(lots, 0, NOW)).toBeNull();
    expect(planDraw(lots, 1.5, NOW)).toBeNull();
  });
});

describe('planReturn', () => {
  it('prefers lots with debited units, earliest expiry first, and reports leftover', () => {
    const lots = [
      lot('none', 9, null, 0, 0),
      lot('late', 0, '2026-09-01T00:00:00Z', 0, 2),
      lot('soon', 0, '2026-07-01T00:00:00Z', 0, 3),
    ];
    expect(planReturn(lots, 4)).toEqual({
      parts: [
        { lotId: 'soon', units: 3 },
        { lotId: 'late', units: 1 },
      ],
      leftover: 0,
    });
    expect(planReturn(lots, 7).leftover).toBe(2);
  });
});
