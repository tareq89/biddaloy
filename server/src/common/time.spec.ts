import { afterEach, describe, expect, it, vi } from 'vitest';
import { endOfLocalDay, localDate, localToday, startOfLocalDay, todayInSchoolTz } from './time';

const freeze = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe('time helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('localToday just before Dhaka midnight', () => {
    freeze('2026-10-07T17:59:00Z');
    expect(localToday()).toBe('2026-10-07');
    expect(localToday('UTC')).toBe('2026-10-07');
  });
  it('localToday at Dhaka midnight', () => {
    freeze('2026-10-07T18:00:00Z');
    expect(localToday()).toBe('2026-10-08');
    expect(localToday('UTC')).toBe('2026-10-07');
  });
  it('localToday at 05:59 Dhaka', () => {
    freeze('2026-10-07T23:59:00Z');
    expect(localToday()).toBe('2026-10-08');
    expect(localToday('UTC')).toBe('2026-10-07');
  });
  it('localToday at UTC midnight', () => {
    freeze('2026-10-08T00:00:00Z');
    expect(localToday()).toBe('2026-10-08');
    expect(localToday('UTC')).toBe('2026-10-08');
  });
  it('localToday across the year boundary', () => {
    freeze('2026-12-31T18:00:00Z');
    expect(localToday()).toBe('2027-01-01');
    expect(localToday('UTC')).toBe('2026-12-31');
  });
  it('localToday honours a DST timezone', () => {
    freeze('2026-10-08T03:30:00Z');
    expect(localToday('America/New_York')).toBe('2026-10-07');
    expect(localToday()).toBe('2026-10-08');
  });
  it('startOfLocalDay Dhaka', () => {
    expect(startOfLocalDay('2026-10-08').toISOString()).toBe('2026-10-07T18:00:00.000Z');
  });
  it('endOfLocalDay Dhaka', () => {
    expect(endOfLocalDay('2026-10-07').toISOString()).toBe('2026-10-07T17:59:59.999Z');
  });
  it('startOfLocalDay UTC', () => {
    expect(startOfLocalDay('2026-10-08', 'UTC').toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
  it('handles a 23-hour DST day', () => {
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(endOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-09T03:59:59.999Z',
    );
  });
  it('localDate of a late-UTC instant is next day in Dhaka', () => {
    expect(localDate(new Date('2026-09-04T19:00:00Z'))).toBe('2026-09-05');
  });
  it('todayInSchoolTz equals localToday', () => {
    freeze('2026-10-07T18:00:00Z');
    expect(todayInSchoolTz()).toBe(localToday());
  });
});
