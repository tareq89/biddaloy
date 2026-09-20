import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PublicHolidaySource } from '@biddaloy/shared';
import {
  PublicHolidayFetchService,
  PublicHolidaySourceUnavailableError,
} from './public-holiday-fetch.service';

function icsBody(): string {
  return [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260101',
    'DTEND;VALUE=DATE:20260102',
    'SUMMARY:New Year',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20250101',
    'DTEND;VALUE=DATE:20250102',
    'SUMMARY:Old Year (different year, filtered out)',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function makeService(): PublicHolidayFetchService {
  const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
  return new PublicHolidayFetchService(config);
}

describe('PublicHolidayFetchService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns Google ICS entries filtered to the requested year', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(icsBody()),
    });

    const service = makeService();
    const result = await service.fetch('BD', 2026);

    expect(result.source).toBe(PublicHolidaySource.GOOGLE_ICS);
    expect(result.entries).toEqual([
      { date: '2026-01-01', end_date: '2026-01-01', name: 'New Year' },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      'calendar.google.com/calendar/ical/en.bangladesh',
    );
  });

  it('falls back to Nager.Date when Google returns non-200', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('') })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([{ date: '2026-01-01', localName: 'নববর্ষ', name: "New Year's Day" }]),
      });

    const service = makeService();
    const result = await service.fetch('BD', 2026);

    expect(result.source).toBe(PublicHolidaySource.NAGER_DATE);
    expect(result.entries).toEqual([
      { date: '2026-01-01', end_date: '2026-01-01', name: 'নববর্ষ' },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to Nager.Date when Google returns an empty feed', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ date: '2026-01-01', name: 'New Year' }]),
      });

    const service = makeService();
    const result = await service.fetch('BD', 2026);

    expect(result.source).toBe(PublicHolidaySource.NAGER_DATE);
  });

  it('skips straight to Nager.Date for a country with no Google calendar id', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ date: '2026-01-01', name: 'Some Holiday' }]),
    });

    const service = makeService();
    const result = await service.fetch('ZZ', 2026);

    expect(result.source).toBe(PublicHolidaySource.NAGER_DATE);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws PublicHolidaySourceUnavailableError when both sources fail', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('') })
      .mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.resolve([]) });

    const service = makeService();

    await expect(service.fetch('BD', 2026)).rejects.toBeInstanceOf(
      PublicHolidaySourceUnavailableError,
    );
  });

  it('treats a fetch that throws (e.g. abort/timeout) as a failed source, not an unhandled rejection', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ date: '2026-01-01', name: 'Some Holiday' }]),
      });

    const service = makeService();
    const result = await service.fetch('BD', 2026);

    expect(result.source).toBe(PublicHolidaySource.NAGER_DATE);
  });
});
