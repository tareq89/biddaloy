import { afterEach, describe, expect, it, vi } from 'vitest';
import { endOfLocalDay, localDate, localToday, startOfLocalDay, todayInSchoolTz } from './time';

function freeze(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('localToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Dhaka 7 Oct 23:59 is still the 7th', () => {
    freeze('2026-10-07T17:59:00Z');
    expect(localToday()).toBe('2026-10-07');
    expect(localToday('UTC')).toBe('2026-10-07');
  });

  it('Dhaka 8 Oct 00:00 is the 8th while UTC is still the 7th', () => {
    freeze('2026-10-07T18:00:00Z');
    expect(localToday()).toBe('2026-10-08');
    expect(localToday('UTC')).toBe('2026-10-07');
  });

  it('Dhaka 8 Oct 05:59 is the 8th while UTC is still the 7th', () => {
    freeze('2026-10-07T23:59:00Z');
    expect(localToday()).toBe('2026-10-08');
    expect(localToday('UTC')).toBe('2026-10-07');
  });

  it('Dhaka 8 Oct 06:00 and UTC agree on the 8th', () => {
    freeze('2026-10-08T00:00:00Z');
    expect(localToday()).toBe('2026-10-08');
    expect(localToday('UTC')).toBe('2026-10-08');
  });

  it('crosses the year boundary in Dhaka before UTC', () => {
    freeze('2026-12-31T18:00:00Z');
    expect(localToday()).toBe('2027-01-01');
    expect(localToday('UTC')).toBe('2026-12-31');
  });

  it('honours a non-Dhaka timezone with DST', () => {
    freeze('2026-10-08T03:30:00Z');
    expect(localToday('America/New_York')).toBe('2026-10-07');
    expect(localToday()).toBe('2026-10-08');
  });

  it('todayInSchoolTz matches localToday()', () => {
    freeze('2026-10-07T18:00:00Z');
    expect(todayInSchoolTz()).toBe(localToday());
  });
});

describe('localDate', () => {
  it('2026-09-04T19:00Z is already the 5th in Dhaka', () => {
    expect(localDate(new Date('2026-09-04T19:00:00Z'))).toBe('2026-09-05');
  });
});

describe('startOfLocalDay / endOfLocalDay', () => {
  it('start of 8 Oct in Dhaka is 7 Oct 18:00Z', () => {
    expect(startOfLocalDay('2026-10-08').toISOString()).toBe('2026-10-07T18:00:00.000Z');
  });

  it('end of 7 Oct in Dhaka is 17:59:59.999Z', () => {
    expect(endOfLocalDay('2026-10-07').toISOString()).toBe('2026-10-07T17:59:59.999Z');
  });

  it('start of day in UTC is UTC midnight', () => {
    expect(startOfLocalDay('2026-10-08', 'UTC').toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('handles a 23-hour DST day in New York', () => {
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(endOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-09T03:59:59.999Z',
    );
  });
});
