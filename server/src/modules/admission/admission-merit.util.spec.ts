import { describe, it, expect } from 'vitest';
import { meritOrder, toHundredths, type MeritRow } from './admission-merit.util';

const row = (
  id: string,
  score: number,
  dob = '2015-01-01',
  at = '2026-01-01T00:00:00Z',
): MeritRow => ({
  applicant_id: id,
  score_hundredths: score,
  date_of_birth: dob,
  created_at: at,
});
const ids = (rows: MeritRow[], tb?: Parameters<typeof meritOrder>[1]) =>
  meritOrder(rows, tb).map((r) => r.applicant_id);

describe('meritOrder', () => {
  it('orders by score desc and ranks from 1', () => {
    const out = meritOrder([row('a', 5000), row('b', 9000), row('c', 7000)]);
    expect(out.map((r) => [r.applicant_id, r.merit_rank])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });
  it('tie: older date of birth first', () => {
    expect(ids([row('a', 100, '2015-05-01'), row('b', 100, '2014-05-01')])).toEqual(['b', 'a']);
  });
  it('tie: same dob, earlier application first', () => {
    expect(
      ids([row('a', 100, '2015-01-01', '2026-02-01'), row('b', 100, '2015-01-01', '2026-01-01')]),
    ).toEqual(['b', 'a']);
  });
  it('tie: then id', () => {
    expect(ids([row('b', 100), row('a', 100)])).toEqual(['a', 'b']);
  });
  it('a configured tie-break order wins over the default', () => {
    const rows = [
      row('a', 100, '2014-01-01', '2026-02-01'),
      row('b', 100, '2015-01-01', '2026-01-01'),
    ];
    expect(ids(rows)).toEqual(['a', 'b']);
    expect(ids(rows, ['APPLIED_AT', 'DOB'])).toEqual(['b', 'a']);
  });
  it('is stable and does not mutate the input', () => {
    const rows = [row('b', 1), row('a', 1)];
    expect(ids(rows)).toEqual(ids([...rows].reverse()));
    expect(rows[0].applicant_id).toBe('b');
  });
});

describe('toHundredths', () => {
  it('parses without float error', () => {
    expect(toHundredths('12.34')).toBe(1234);
    expect(toHundredths('0.30')).toBe(30);
    expect(toHundredths('7')).toBe(700);
    expect(toHundredths(19.99)).toBe(1999);
  });
  it('refuses 3 decimals and junk', () => {
    expect(toHundredths('1.234')).toBeNull();
    expect(toHundredths('abc')).toBeNull();
    expect(toHundredths(null)).toBeNull();
  });
});
