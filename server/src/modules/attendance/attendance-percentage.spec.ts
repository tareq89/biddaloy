import { describe, it, expect } from 'vitest';
import { computeAttendancePercentage } from './attendance-summary.service';

const basePolicy = {
  percentageDenominator: 'WORKING_DAYS' as const,
  leaveCountsAsWorkingDay: false,
  lateCountsAsPresent: true,
};

describe('computeAttendancePercentage', () => {
  it('is 100 when every working day is present', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 20,
        marked_days: 20,
        present_days: 20,
        late_days: 0,
        absent_days: 0,
        leave_days: 0,
      },
      basePolicy,
    );
    expect(percentage).toBe(100);
  });

  it('counts LATE toward the numerator when lateCountsAsPresent is true', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 20,
        marked_days: 20,
        present_days: 15,
        late_days: 5,
        absent_days: 0,
        leave_days: 0,
      },
      { ...basePolicy, lateCountsAsPresent: true },
    );
    expect(percentage).toBe(100);
  });

  it('does not count LATE toward the numerator when lateCountsAsPresent is false', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 20,
        marked_days: 20,
        present_days: 15,
        late_days: 5,
        absent_days: 0,
        leave_days: 0,
      },
      { ...basePolicy, lateCountsAsPresent: false },
    );
    expect(percentage).toBe(75);
  });

  it('keeps LEAVE in the denominator when leaveCountsAsWorkingDay is true', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 20,
        marked_days: 20,
        present_days: 15,
        late_days: 0,
        absent_days: 0,
        leave_days: 5,
      },
      { ...basePolicy, leaveCountsAsWorkingDay: true },
    );
    expect(percentage).toBe(75);
  });

  it('removes LEAVE from the denominator when leaveCountsAsWorkingDay is false', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 20,
        marked_days: 20,
        present_days: 15,
        late_days: 0,
        absent_days: 0,
        leave_days: 5,
      },
      { ...basePolicy, leaveCountsAsWorkingDay: false },
    );
    // denominator = 20 - 5 = 15; numerator = 15 -> 100%
    expect(percentage).toBe(100);
  });

  it('uses marked_days as the denominator when percentageDenominator is MARKED_DAYS', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 20,
        marked_days: 10,
        present_days: 10,
        late_days: 0,
        absent_days: 0,
        leave_days: 0,
      },
      { ...basePolicy, percentageDenominator: 'MARKED_DAYS' },
    );
    expect(percentage).toBe(100);
  });

  it('uses working_days as the denominator when percentageDenominator is WORKING_DAYS', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 20,
        marked_days: 10,
        present_days: 10,
        late_days: 0,
        absent_days: 0,
        leave_days: 0,
      },
      { ...basePolicy, percentageDenominator: 'WORKING_DAYS' },
    );
    expect(percentage).toBe(50);
  });

  it('returns null, never 0, when there are zero working days', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 0,
        marked_days: 0,
        present_days: 0,
        late_days: 0,
        absent_days: 0,
        leave_days: 0,
      },
      basePolicy,
    );
    expect(percentage).toBeNull();
  });

  it('returns null when leave days consume the entire denominator', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 5,
        marked_days: 5,
        present_days: 0,
        late_days: 0,
        absent_days: 0,
        leave_days: 5,
      },
      { ...basePolicy, leaveCountsAsWorkingDay: false },
    );
    expect(percentage).toBeNull();
  });

  it('rounds to 2 decimal places', () => {
    const percentage = computeAttendancePercentage(
      {
        working_days: 3,
        marked_days: 3,
        present_days: 1,
        late_days: 0,
        absent_days: 0,
        leave_days: 0,
      },
      basePolicy,
    );
    // 1/3 * 100 = 33.3333...
    expect(percentage).toBe(33.33);
  });
});
