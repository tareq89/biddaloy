import { describe, expect, it } from 'vitest';

import { dpiLevel, effectiveDpi } from './dpi';

describe('effectiveDpi', () => {
  it('a 1011 px wide image across an 85.6 mm card is about 300 dpi', () => {
    expect(effectiveDpi(1011, 85.6)).toBeCloseTo(300, 0);
  });

  it('the same image in half the width is twice as sharp', () => {
    expect(effectiveDpi(1011, 42.8)).toBeCloseTo(600, 0);
  });

  it('is 0 (never NaN or Infinity) when there is nothing to measure', () => {
    expect(effectiveDpi(0, 85.6)).toBe(0);
    expect(effectiveDpi(1011, 0)).toBe(0);
    expect(effectiveDpi(1011, -5)).toBe(0);
  });
});

describe('dpiLevel', () => {
  it.each([
    [1011 / (85.6 / 25.4), 'good'],
    [300, 'good'],
    [299.6, 'good'], // rounds to 300
    [299.4, 'ok'],
    [150, 'ok'],
    [149.6, 'ok'], // rounds to 150
    [149.4, 'low'],
    [0, 'low'],
  ] as const)('%d dpi is %s', (dpi, level) => {
    expect(dpiLevel(dpi)).toBe(level);
  });

  it('a 400 px image across an 85.6 mm card is low', () => {
    expect(dpiLevel(effectiveDpi(400, 85.6))).toBe('low');
  });
});
