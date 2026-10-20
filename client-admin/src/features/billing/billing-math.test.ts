import { describe, expect, it } from 'vitest';

import { daysUntil, defaultSeats, orderTotalPaisa, parseWhole } from './billing-math';

describe('billing math', () => {
  it('prices seats x months x 1000 paisa, as an integer', () => {
    expect(orderTotalPaisa(100, 3)).toBe(300_000);
    expect(orderTotalPaisa(100_000, 24)).toBe(2_400_000_000);
  });

  it('prefills the uncovered students, never under 100', () => {
    expect(defaultSeats(500, 200)).toBe(300);
    expect(defaultSeats(120, 100)).toBe(100);
    expect(defaultSeats(0, 0)).toBe(100);
  });

  it('accepts whole numbers inside the bounds only', () => {
    expect(parseWhole('1', 24)).toBe(1);
    expect(parseWhole('24', 24)).toBe(24);
    expect(parseWhole('0', 24)).toBeNull();
    expect(parseWhole('25', 24)).toBeNull();
    expect(parseWhole('1.5', 24)).toBeNull();
    expect(parseWhole('', 24)).toBeNull();
    expect(parseWhole('-3', 24)).toBeNull();
    expect(parseWhole('১২', 24)).toBe(12);
  });

  it('counts whole days to a date', () => {
    const now = new Date('2027-03-01T05:00:00Z');
    expect(daysUntil('2027-03-11', now)).toBe(10);
    expect(daysUntil('2027-02-28', now)).toBe(-1);
  });
});
