import { describe, it, expect } from 'vitest';
import { shiftTerms } from './academic-terms.service';

// [69.1.09] Date shifting for year rollover, no database needed.
const term = (seq: number, name: string, start_date: string, end_date: string) => ({
  seq,
  name,
  start_date,
  end_date,
});

describe('shiftTerms', () => {
  it('moves every term by the gap between the two years start dates', () => {
    const out = shiftTerms(
      [term(1, 'T1', '2026-01-01', '2026-04-30'), term(2, 'T2', '2026-05-01', '2026-08-31')],
      '2026-01-01',
      '2027-01-01',
      '2027-12-31',
    );
    expect(out.map((t) => [t.start_date, t.end_date])).toEqual([
      ['2027-01-01', '2027-04-30'],
      ['2027-05-01', '2027-08-31'],
    ]);
  });

  it('counts a leap day in the offset (2027 -> 2028)', () => {
    // 2028-01-01 -> 2029-01-01 is 366 days (2028 is a leap year). The shift is a fixed
    // day count (D14), so a term ending 2028-03-01 lands on 2029-03-02.
    const out = shiftTerms(
      [term(1, 'T1', '2028-02-28', '2028-03-01')],
      '2028-01-01',
      '2029-01-01',
      '2029-12-31',
    );
    expect(out[0]).toMatchObject({ start_date: '2029-02-28', end_date: '2029-03-02' });
  });

  it("clamps the last term's end to the target year's end", () => {
    const out = shiftTerms(
      [term(1, 'T1', '2026-07-01', '2026-12-31')],
      '2026-01-01',
      '2027-01-01',
      '2027-12-30',
    );
    expect(out[0].end_date).toBe('2027-12-30');
  });

  it('clamps a non-last term that would end after a shorter target year', () => {
    const out = shiftTerms(
      [term(1, 'T1', '2026-01-01', '2026-06-30'), term(2, 'T2', '2026-07-01', '2026-12-31')],
      '2026-01-01',
      '2027-01-01',
      '2027-03-31',
    );
    expect(out.map((t) => t.end_date)).toEqual(['2027-03-31', '2027-03-31']);
  });

  it('returns an empty list for no terms', () => {
    expect(shiftTerms([], '2026-01-01', '2027-01-01', '2027-12-31')).toEqual([]);
  });
});
