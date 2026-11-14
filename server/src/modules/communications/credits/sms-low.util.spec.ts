import { describe, it, expect } from 'vitest';
import { isAlmostFinished } from './sms-low.util';

const lots = (...totals: number[]) => totals.map((units_total) => ({ units_total }));

describe('isAlmostFinished', () => {
  it.each([
    ['100 is almost finished', 100, lots(100), true, false],
    ['101 of a 1000 lot is not', 101, lots(1000), false, false],
    ['101 of a 2000 lot is (10% = 200)', 101, lots(2000), true, false],
    ['10% is strict: 200 of 2000 is not', 200, lots(2000), false, false],
    ['zero is stopped and almost finished', 0, lots(500), true, true],
    ['no active lots, zero left', 0, [], true, true],
    ['no active lots, 150 left', 150, [], false, false],
    ['no-expiry lots count too (sum 3000)', 250, lots(1000, 2000), true, false],
  ])('%s', (_n, remaining, activeLots, almostFinished, stopped) => {
    expect(isAlmostFinished({ remaining, activeLots })).toEqual({ almostFinished, stopped });
  });
});
