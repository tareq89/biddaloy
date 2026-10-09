import { describe, it, expect } from 'vitest';
import { MONTH_NAMES, periodStartFromLabel } from './invoice-period.util';

describe('periodStartFromLabel', () => {
  it('turns "<Month> <yyyy>" into "yyyy-MM"', () => {
    expect(periodStartFromLabel('April 2026')).toBe('2026-04');
    expect(periodStartFromLabel('December 2025')).toBe('2025-12');
  });

  it('returns undefined for anything else', () => {
    expect(periodStartFromLabel('Fee')).toBeUndefined();
    expect(periodStartFromLabel('')).toBeUndefined();
    expect(periodStartFromLabel('Apr 2026')).toBeUndefined();
    expect(periodStartFromLabel('undefined 2026')).toBeUndefined();
  });

  // The writer builds `${MONTH_NAMES[month - 1]} ${year}`; every month must round-trip.
  it('round-trips all 12 months in the writer format', () => {
    MONTH_NAMES.forEach((name, i) => {
      expect(periodStartFromLabel(`${name} 2026`)).toBe(`2026-${String(i + 1).padStart(2, '0')}`);
    });
  });
});
