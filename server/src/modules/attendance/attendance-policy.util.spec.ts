import { describe, it, expect, vi, afterEach } from 'vitest';
import { AttendanceStatus } from '@biddaloy/shared';
import type { AttendancePolicySettings, TenantSettings } from '@biddaloy/shared';
import {
  classifyCheckIn,
  daysBetween,
  isWeeklyOff,
  localDate,
  localToday,
  resolveAttendancePolicy,
} from './attendance-policy.util';

const POLICY: AttendancePolicySettings = {
  weeklyOffDays: [5], // Friday, matching Bangladesh's default weekend
  lateAfter: '08:15',
  absentAfter: '10:00',
  correctionWindowDays: 2,
  lowAttendanceThresholdPercent: 75,
  lateCountsAsPresent: true,
  leaveCountsAsWorkingDay: false,
  percentageDenominator: 'WORKING_DAYS',
  allowFutureDates: false,
  autoAbsentNotification: { enabled: false, cutoffTime: '11:00' },
};

describe('resolveAttendancePolicy', () => {
  it('returns the resolved attendance settings', () => {
    const settings: TenantSettings = { version: 1, attendance: POLICY };
    expect(resolveAttendancePolicy(settings)).toBe(POLICY);
  });

  it('throws when handed a settings object with no resolved attendance section', () => {
    const settings: TenantSettings = { version: 1 };
    expect(() => resolveAttendancePolicy(settings)).toThrow(/has no resolved attendance policy/);
  });
});

describe('isWeeklyOff', () => {
  // 2026-09-04 is a Friday; walking each day of that week covers all 7
  // weekdays against the same Friday-off policy.
  const days: Record<string, string> = {
    Sunday: '2026-08-30',
    Monday: '2026-08-31',
    Tuesday: '2026-09-01',
    Wednesday: '2026-09-02',
    Thursday: '2026-09-03',
    Friday: '2026-09-04',
    Saturday: '2026-09-05',
  };

  it('is true only for the configured weekly off day (Friday)', () => {
    for (const [name, dateIso] of Object.entries(days)) {
      expect(isWeeklyOff(dateIso, POLICY)).toBe(name === 'Friday');
    }
  });

  it('respects a different weekly off configuration (Saturday+Sunday)', () => {
    const weekendPolicy: AttendancePolicySettings = { ...POLICY, weeklyOffDays: [0, 6] };
    expect(isWeeklyOff(days.Sunday, weekendPolicy)).toBe(true);
    expect(isWeeklyOff(days.Saturday, weekendPolicy)).toBe(true);
    expect(isWeeklyOff(days.Monday, weekendPolicy)).toBe(false);
  });
});

describe('localToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the tenant-local calendar date, which can differ from UTC', () => {
    // 2026-09-04T19:00Z is 2026-09-05 01:00 in Asia/Dhaka (UTC+6) — already
    // the next calendar day locally.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T19:00:00Z'));

    expect(localToday('Asia/Dhaka')).toBe('2026-09-05');
    expect(localToday('UTC')).toBe('2026-09-04');
  });
});

describe('localDate', () => {
  it('resolves an arbitrary instant to its tenant-local calendar date', () => {
    const instant = new Date('2026-09-04T19:00:00Z');
    expect(localDate(instant, 'Asia/Dhaka')).toBe('2026-09-05');
    expect(localDate(instant, 'UTC')).toBe('2026-09-04');
  });
});

describe('daysBetween', () => {
  it('is 0 for the same date', () => {
    expect(daysBetween('2026-09-04', '2026-09-04')).toBe(0);
  });

  it('is positive when the second date is later', () => {
    expect(daysBetween('2026-09-01', '2026-09-04')).toBe(3);
  });

  it('is negative when the second date is earlier', () => {
    expect(daysBetween('2026-09-04', '2026-09-01')).toBe(-3);
  });
});

describe('classifyCheckIn', () => {
  const timezone = 'Asia/Dhaka';

  it('is PRESENT at or before lateAfter', () => {
    const result = classifyCheckIn(
      new Date('2026-09-04T02:00:00Z'), // 08:00 local
      '2026-09-04',
      POLICY,
      timezone,
    );
    expect(result).toEqual({ status: AttendanceStatus.PRESENT, minutesLate: null });
  });

  it('is LATE between lateAfter and absentAfter, with the correct minutesLate', () => {
    const result = classifyCheckIn(
      new Date('2026-09-04T02:30:00Z'), // 08:30 local — 15 minutes after 08:15
      '2026-09-04',
      POLICY,
      timezone,
    );
    expect(result).toEqual({ status: AttendanceStatus.LATE, minutesLate: 15 });
  });

  it('is ABSENT after absentAfter', () => {
    const result = classifyCheckIn(
      new Date('2026-09-04T04:30:00Z'), // 10:30 local
      '2026-09-04',
      POLICY,
      timezone,
    );
    expect(result).toEqual({ status: AttendanceStatus.ABSENT, minutesLate: null });
  });
});
