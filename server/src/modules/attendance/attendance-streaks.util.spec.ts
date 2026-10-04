import { describe, it, expect } from 'vitest';
import { AttendanceStatus as S } from '@biddaloy/shared';
import { currentStreaks } from './attendance-streaks.util';

/** statuses newest first; `null` = no record. */
function run(statuses: Array<S | null>) {
  const sessions = statuses.map((_, i) => ({
    id: `s${i}`,
    date: `2026-09-${String(30 - i).padStart(2, '0')}`,
  }));
  const marks = new Map<string, S>();
  statuses.forEach((st, i) => {
    if (st) marks.set(`s${i}`, st);
  });
  return currentStreaks(sessions, ['stu'], new Map([['stu', marks]]));
}
const rep = (st: S, n: number) => Array<S>(n).fill(st);

describe('currentStreaks', () => {
  it('flags 3 absents, not 2', () => {
    expect(run(rep(S.ABSENT, 3))).toEqual([
      { student_id: 'stu', status: S.ABSENT, length: 3, since_date: '2026-09-28' },
    ]);
    expect(run(rep(S.ABSENT, 2))).toEqual([]);
  });
  it('A,A,L newest first is an absent run of 2, not flagged', () => {
    expect(run([S.ABSENT, S.ABSENT, S.LATE])).toEqual([]);
  });
  it('counts only the newest run', () => {
    expect(run([...rep(S.LATE, 4), S.PRESENT])[0]).toMatchObject({ status: S.LATE, length: 4 });
  });
  it('LEAVE breaks the run', () => {
    expect(run([S.ABSENT, S.ABSENT, S.LEAVE, S.ABSENT, S.ABSENT])).toEqual([]);
    expect(run([S.LEAVE, ...rep(S.ABSENT, 5)])).toEqual([]);
  });
  it('a missing record breaks the run', () => {
    expect(run([S.ABSENT, S.ABSENT, null, S.ABSENT])).toEqual([]);
    expect(run([null, ...rep(S.ABSENT, 5)])).toEqual([]);
  });
  it('flags 15 PRESENT, not 14', () => {
    expect(run(rep(S.PRESENT, 15))[0]).toMatchObject({ status: S.PRESENT, length: 15 });
    expect(run(rep(S.PRESENT, 14))).toEqual([]);
  });
  it('LATE does not count toward PRESENT', () => {
    expect(run([...rep(S.LATE, 2), ...rep(S.PRESENT, 13)])).toEqual([]);
  });
  it('empty sessions -> []', () => {
    expect(currentStreaks([], ['stu'], new Map())).toEqual([]);
  });
});
