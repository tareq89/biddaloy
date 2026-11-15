import { describe, expect, it } from 'vitest';

import { nextAction, type DeskCounts } from './next-action';

const now = '2027-02-10';
const base: DeskCounts = { applicants: 5, feePending: 0, seatsLeft: 2, stages: [], lists: [] };
const merit = {
  kind: 'MERIT' as const,
  sequence: 1,
  act_by_date: '2027-02-01',
  activated_at: '2027-01-25',
};
const wait1 = { kind: 'WAITING' as const, sequence: 1, act_by_date: null, activated_at: null };

describe('nextAction', () => {
  it('empty round', () => expect(nextAction({ ...base, applicants: 0 }, now).key).toBe('empty'));
  it('fee check pending comes first, even with stages and lists', () => {
    const a = nextAction(
      { ...base, feePending: 3, stages: [{ id: 's1', kind: 'WRITTEN' }], lists: [merit] },
      now,
    );
    expect(a).toMatchObject({ key: 'feePending', count: 3, step: 'applicants' });
  });
  it('a stage with a committed cut-off is done, so the card moves on', () => {
    const stages = [{ id: 's1', kind: 'WRITTEN' as const, done: true }];
    expect(nextAction({ ...base, stages }, now).key).toBe('makeMerit');
    expect(
      nextAction({ ...base, stages: [{ id: 's1', kind: 'WRITTEN' as const, done: false }] }, now)
        .key,
    ).toBe('enterMarks');
  });
  it('marks, then lottery, per stage kind', () => {
    expect(nextAction({ ...base, stages: [{ id: 's1', kind: 'WRITTEN' }] }, now)).toMatchObject({
      key: 'enterMarks',
      step: 's1',
    });
    expect(nextAction({ ...base, stages: [{ id: 's2', kind: 'LOTTERY' }] }, now).key).toBe(
      'drawLottery',
    );
  });
  it('done stages or none: make the merit list', () => {
    expect(nextAction(base, now).key).toBe('makeMerit');
    expect(
      nextAction({ ...base, stages: [{ id: 's1', kind: 'WRITTEN', done: true }] }, now).key,
    ).toBe('makeMerit');
  });
  it('overdue merit list with seats left starts waiting list 1', () => {
    expect(nextAction({ ...base, lists: [merit, wait1] }, now)).toMatchObject({
      key: 'startWaiting',
      n: 1,
    });
  });
  it('no seats left or time not over: publish', () => {
    expect(nextAction({ ...base, seatsLeft: 0, lists: [merit, wait1] }, now).key).toBe('publish');
    expect(nextAction({ ...base, lists: [merit, wait1] }, '2027-01-30').key).toBe(
      'publish',
    );
    // The act-by day itself is still open (server: act_by_date < today).
    expect(nextAction({ ...base, lists: [merit, wait1] }, merit.act_by_date).key).toBe('publish');
  });
});
