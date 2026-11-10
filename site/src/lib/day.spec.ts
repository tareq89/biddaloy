import { describe, expect, it } from 'vitest';
import { formatDay } from './day';

describe('formatDay', () => {
  // Regression (#3712): the old code read the day as +06:00 and printed it in Asia/Dhaka, so a
  // school elsewhere saw its own date shifted. A bare day must print as itself, in any zone.
  it('prints the same day whatever the process timezone is', () => {
    const was = process.env.TZ;
    for (const tz of ['Asia/Dhaka', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      expect(formatDay('2026-12-15', 'en-GB', { day: '2-digit' })).toBe('15');
    }
    process.env.TZ = was;
  });
  it('formats a long date', () => {
    expect(formatDay('2026-12-15', 'en-GB', { dateStyle: 'long' })).toBe('15 December 2026');
  });
  it('rejects a missing or malformed day', () => {
    expect(formatDay(undefined, 'en-GB', {})).toBeUndefined();
    expect(formatDay('2026-13-45', 'en-GB', {})).toBeUndefined();
    expect(formatDay('2026-12-15T00:00:00Z', 'en-GB', {})).toBeUndefined();
  });
});
