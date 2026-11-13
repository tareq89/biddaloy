import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { revenueWindow } from './revenue-month';

describe('revenueWindow', () => {
  it('starts and ends at Dhaka midnight (UTC+6)', () => {
    const w = revenueWindow('2026-03');
    expect(w.start.toISOString()).toBe('2026-02-28T18:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-31T18:00:00.000Z');
  });
  it('December rolls into January of the next year', () => {
    const w = revenueWindow('2026-12');
    expect(w.start.toISOString()).toBe('2026-11-30T18:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });
  it('January starts at the previous December evening UTC', () => {
    expect(revenueWindow('2027-01').start.toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });
  it('defaults to the current month', () => {
    expect(revenueWindow().month).toMatch(/^\d{4}-\d{2}$/);
  });
  it.each(['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', '', ' 2026-01', 'abcd-ef'])(
    'rejects %j',
    (bad) => {
      expect(() => revenueWindow(bad)).toThrow(BadRequestException);
    },
  );
});
