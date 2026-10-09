import { describe, it, expect } from 'vitest';
import { isInQuietHours, quietHoursEnd } from './alert-delivery.service';

const wrap = { start: '21:00', end: '07:00' };

describe('isInQuietHours', () => {
  it('wrapping window covers the evening and the early morning, end is exclusive', () => {
    expect(isInQuietHours('21:00', wrap)).toBe(true);
    expect(isInQuietHours('06:59', wrap)).toBe(true);
    expect(isInQuietHours('07:00', wrap)).toBe(false);
    expect(isInQuietHours('20:59', wrap)).toBe(false);
  });

  it('non-wrapping window is [start, end)', () => {
    const q = { start: '13:00', end: '14:00' };
    expect(isInQuietHours('13:30', q)).toBe(true);
    expect(isInQuietHours('14:00', q)).toBe(false);
  });

  it('start === end means never quiet', () => {
    expect(isInQuietHours('21:00', { start: '21:00', end: '21:00' })).toBe(false);
  });
});

describe('quietHoursEnd (Asia/Dhaka)', () => {
  it('evening instant ends at 07:00 the next local day', () => {
    // 22:00 Dhaka on Oct 9 -> 07:00 Dhaka on Oct 10 = 01:00Z
    const end = quietHoursEnd(new Date('2026-10-09T16:00:00Z'), 'Asia/Dhaka', wrap);
    expect(end.toISOString()).toBe('2026-10-10T01:00:00.000Z');
  });

  it('after-midnight instant ends the same local day (midnight boundary)', () => {
    // 00:30 Dhaka on Oct 10 -> 07:00 Dhaka on Oct 10
    const end = quietHoursEnd(new Date('2026-10-09T18:30:00Z'), 'Asia/Dhaka', wrap);
    expect(end.toISOString()).toBe('2026-10-10T01:00:00.000Z');
  });
});
