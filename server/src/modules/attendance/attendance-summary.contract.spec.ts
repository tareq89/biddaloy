import { describe, it, expect } from 'vitest';
import type { AttendanceSummary } from './attendance-summary.service';

/**
 * `AttendanceSummary` is a contract with a future exam module — [9.8],
 * [9.9], [9.10] and later epics all read this exact key set. Adding a key
 * is allowed; renaming or removing one is a breaking change that must be
 * raised with the user first. This test exists purely so a change to the
 * key set fails CI instead of silently shipping.
 */
describe('AttendanceSummary contract', () => {
  it('has exactly the frozen key set', () => {
    const summary: AttendanceSummary = {
      student_id: 's1',
      from: '2026-09-01',
      to: '2026-09-30',
      working_days: 20,
      marked_days: 20,
      present_days: 18,
      late_days: 1,
      absent_days: 1,
      leave_days: 0,
      unmarked_days: 0,
      attendance_percentage: 95,
      policy: {
        late_counts_as_present: true,
        leave_counts_as_working_day: false,
        denominator: 'WORKING_DAYS',
      },
    };

    expect(Object.keys(summary).sort()).toEqual(
      [
        'student_id',
        'from',
        'to',
        'working_days',
        'marked_days',
        'present_days',
        'late_days',
        'absent_days',
        'leave_days',
        'unmarked_days',
        'attendance_percentage',
        'policy',
      ].sort(),
    );
    expect(Object.keys(summary.policy).sort()).toEqual(
      ['late_counts_as_present', 'leave_counts_as_working_day', 'denominator'].sort(),
    );
  });
});
