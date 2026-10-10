import { describe, expect, it } from 'vitest';
import { percentile, perfGuardError } from './perf-attention';

// The script seeds 10,000 students and deletes Redis keys. These tests pin the guard
// that keeps it away from any database that is not a throwaway `_perf` one.
describe('perfGuardError', () => {
  it('refuses without --confirm-db', () => {
    expect(perfGuardError([], 'biddaloy_perf')).toMatch(/missing --confirm-db/);
  });

  it('refuses when the confirmed name is not the connected database', () => {
    expect(perfGuardError(['--confirm-db=other_perf'], 'biddaloy_perf')).toMatch(
      /connected database is "biddaloy_perf"/,
    );
  });

  it('refuses a database that does not end in _perf, even when confirmed', () => {
    // A shared or production database must never pass, however carefully it is named.
    expect(perfGuardError(['--confirm-db=biddaloy'], 'biddaloy')).toMatch(
      /does not end in "_perf"/,
    );
  });

  it('accepts a matching _perf database', () => {
    expect(perfGuardError(['--confirm-db=biddaloy_perf'], 'biddaloy_perf')).toBeNull();
  });
});

describe('percentile', () => {
  it('returns the nearest-rank value for a known array', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i); // 100..1, unsorted
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 100)).toBe(100);
  });

  it('handles a single value and an empty list', () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNaN();
  });
});
