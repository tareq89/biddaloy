import { describe, it, expect } from 'vitest';
import { parseIcsEvents } from './ics-parse.util';

function ics(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n');
}

describe('parseIcsEvents', () => {
  it('parses a single-day all-day event', () => {
    const events = parseIcsEvents(
      ics(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260101',
        'DTEND;VALUE=DATE:20260102',
        "SUMMARY:New Year's Day",
        'END:VEVENT',
      ),
    );

    expect(events).toEqual([
      { date: '2026-01-01', end_date: '2026-01-01', name: "New Year's Day" },
    ]);
  });

  it('subtracts one day from an exclusive multi-day DTEND', () => {
    const events = parseIcsEvents(
      ics(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260213',
        'DTEND;VALUE=DATE:20260216',
        'SUMMARY:Eid Holiday',
        'END:VEVENT',
      ),
    );

    expect(events).toEqual([{ date: '2026-02-13', end_date: '2026-02-15', name: 'Eid Holiday' }]);
  });

  it('defaults end_date to date when DTEND is missing', () => {
    const events = parseIcsEvents(
      ics('BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260326', 'SUMMARY:Independence Day', 'END:VEVENT'),
    );

    expect(events).toEqual([
      { date: '2026-03-26', end_date: '2026-03-26', name: 'Independence Day' },
    ]);
  });

  it('parses multiple VEVENTs', () => {
    const events = parseIcsEvents(
      ics(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260101',
        'DTEND;VALUE=DATE:20260102',
        'SUMMARY:New Year',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260321',
        'DTEND;VALUE=DATE:20260322',
        'SUMMARY:Independence Day',
        'END:VEVENT',
      ),
    );

    expect(events).toHaveLength(2);
    expect(events[0].date).toBe('2026-01-01');
    expect(events[1].date).toBe('2026-03-21');
  });

  it('unfolds a SUMMARY continuation line', () => {
    const events = parseIcsEvents(
      ics(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260101',
        'DTEND;VALUE=DATE:20260102',
        'SUMMARY:A very long holiday name that ',
        ' continues onto the next line',
        'END:VEVENT',
      ),
    );

    expect(events[0].name).toBe('A very long holiday name that continues onto the next line');
  });

  it('unescapes ICS text escapes in SUMMARY', () => {
    const events = parseIcsEvents(
      ics(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260101',
        'DTEND;VALUE=DATE:20260102',
        'SUMMARY:Day one\\, day two\\; day three',
        'END:VEVENT',
      ),
    );

    expect(events[0].name).toBe('Day one, day two; day three');
  });

  it('skips a VEVENT missing DTSTART', () => {
    const events = parseIcsEvents(ics('BEGIN:VEVENT', 'SUMMARY:No start date', 'END:VEVENT'));

    expect(events).toEqual([]);
  });

  it('skips a VEVENT missing SUMMARY', () => {
    const events = parseIcsEvents(ics('BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260101', 'END:VEVENT'));

    expect(events).toEqual([]);
  });

  it('ignores unrelated properties (VALARM, RRULE, VTIMEZONE)', () => {
    const events = parseIcsEvents(
      ics(
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Dhaka',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260101',
        'DTEND;VALUE=DATE:20260102',
        'SUMMARY:New Year',
        'RRULE:FREQ=YEARLY',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'END:VALARM',
        'END:VEVENT',
      ),
    );

    expect(events).toEqual([{ date: '2026-01-01', end_date: '2026-01-01', name: 'New Year' }]);
  });

  it('returns [] for an empty document', () => {
    expect(parseIcsEvents('')).toEqual([]);
  });
});
