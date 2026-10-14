import { describe, expect, it } from 'vitest';

import { BG, FILL, STROKE, nearestIndex, niceMax, scaleLinear, ticks } from './chart-utils';

describe('chart-utils', () => {
  it('scaleLinear maps, inverts and handles a flat domain', () => {
    expect(scaleLinear([0, 10], [0, 100])(5)).toBe(50);
    expect(scaleLinear([0, 10], [100, 0])(2)).toBe(80);
    expect(scaleLinear([3, 3], [0, 24])(3)).toBe(12);
  });
  it('niceMax rounds up to 1/2/2.5/5/10 x 10^n', () => {
    expect([0, 7, 87, 120, 1_234_000].map(niceMax)).toEqual([1, 10, 100, 150, 1_500_000]);
  });
  it('ticks span 0..niceMax', () => {
    expect(ticks(87, 2)).toEqual([0, 50, 100]);
  });
  it('nearestIndex picks the closest x', () => {
    expect(nearestIndex(23, [0, 10, 20, 30])).toBe(2);
  });
  it('every colour has fill, bg and stroke classes and no raw hex', () => {
    for (const k of Object.keys(FILL)) {
      for (const m of [FILL, BG, STROKE] as Record<string, string>[]) {
        expect(m[k]).toBeTruthy();
        expect(m[k]).not.toContain('#');
      }
    }
    expect(Object.keys(BG)).toEqual(Object.keys(FILL));
    expect(Object.keys(STROKE)).toEqual(Object.keys(FILL));
  });
});
