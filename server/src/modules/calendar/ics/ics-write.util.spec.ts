import { describe, it, expect } from 'vitest';
import { buildIcsCalendar, escapeIcsText, foldLine, IcsEventInput } from './ics-write.util';
import { parseIcsEvents } from './ics-parse.util';

const NOW = new Date('2026-01-15T12:00:00.000Z');

function allDayEvent(overrides: Partial<IcsEventInput> = {}): IcsEventInput {
  return {
    id: 'evt-1',
    name: "New Year's Day",
    startDate: '2026-01-01',
    endDate: '2026-01-01',
    startTime: null,
    endTime: null,
    timezone: 'Asia/Dhaka',
    sequence: 1700000000,
    category: 'HOLIDAY',
    ...overrides,
  };
}

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines per RFC 5545', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });
});

describe('foldLine', () => {
  it('leaves a short line untouched', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds a line over 75 octets with a leading space continuation', () => {
    const long = 'SUMMARY:' + 'x'.repeat(100);
    const folded = foldLine(long);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' ')).toBe(true);
    }
    // Rejoining (stripping the fold) reconstructs the original line.
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long);
  });

  it('never splits a multi-byte UTF-8 character across a fold boundary', () => {
    // Each 'আ' is a 3-byte UTF-8 codepoint — a naive byte-count fold could
    // slice it in half and produce invalid UTF-8.
    const long = 'SUMMARY:' + 'আ'.repeat(40);
    const folded = foldLine(long);
    for (const line of folded.split('\r\n ')) {
      expect(Buffer.from(line, 'utf8').toString('utf8')).toBe(line);
    }
  });
});

describe('buildIcsCalendar', () => {
  it('emits VCALENDAR wrapper with PRODID and X-WR-CALNAME', () => {
    const ics = buildIcsCalendar({ calendarName: 'Green Valley School', events: [], now: NOW });
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('PRODID:-//Biddaloy//Calendar Feed//EN\r\n');
    expect(ics).toContain('X-WR-CALNAME:Green Valley School\r\n');
    expect(ics).toContain('END:VCALENDAR\r\n');
  });

  it('serializes an all-day event with UID = <id>@biddaloy and no times', () => {
    const ics = buildIcsCalendar({
      calendarName: 'School',
      events: [allDayEvent()],
      now: NOW,
    });
    expect(ics).toContain('UID:evt-1@biddaloy\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260101\r\n');
    // Exclusive DTEND: one day past the inclusive endDate.
    expect(ics).toContain('DTEND;VALUE=DATE:20260102\r\n');
    expect(ics).toContain('CATEGORIES:HOLIDAY\r\n');
    expect(ics).toContain('SEQUENCE:1700000000\r\n');
  });

  it('serializes a multi-day all-day event exclusive DTEND one day past inclusive end', () => {
    const ics = buildIcsCalendar({
      calendarName: 'School',
      events: [allDayEvent({ startDate: '2026-02-13', endDate: '2026-02-15' })],
      now: NOW,
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260213\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20260216\r\n');
  });

  it('serializes a timed event with TZID on DTSTART/DTEND', () => {
    const ics = buildIcsCalendar({
      calendarName: 'School',
      events: [
        allDayEvent({
          id: 'evt-2',
          startTime: '09:00',
          endTime: '11:30',
          category: 'MEETING',
        }),
      ],
      now: NOW,
    });
    expect(ics).toContain('DTSTART;TZID=Asia/Dhaka:20260101T090000\r\n');
    expect(ics).toContain('DTEND;TZID=Asia/Dhaka:20260101T113000\r\n');
  });

  it('escapes commas, semicolons and newlines in SUMMARY/DESCRIPTION', () => {
    const ics = buildIcsCalendar({
      calendarName: 'School',
      events: [
        allDayEvent({
          name: 'PTM, Sec A; B',
          description: 'Bring report card\nand fees book',
        }),
      ],
      now: NOW,
    });
    expect(ics).toContain('SUMMARY:PTM\\, Sec A\\; B\r\n');
    expect(ics).toContain('DESCRIPTION:Bring report card\\nand fees book\r\n');
  });

  it('omits DESCRIPTION when absent', () => {
    const ics = buildIcsCalendar({ calendarName: 'School', events: [allDayEvent()], now: NOW });
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('uses CRLF line endings throughout', () => {
    const ics = buildIcsCalendar({ calendarName: 'School', events: [allDayEvent()], now: NOW });
    expect(ics.includes('\n')).toBe(true);
    // No bare LF without a preceding CR.
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
  });

  it('folds a long SUMMARY at 75 octets', () => {
    const longName = 'A '.repeat(60).trim();
    const ics = buildIcsCalendar({
      calendarName: 'School',
      events: [allDayEvent({ name: longName })],
      now: NOW,
    });
    const summaryLine = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'))!;
    expect(Buffer.from(summaryLine, 'utf8').length).toBeLessThanOrEqual(75);
  });

  it('round-trips an all-day event through ics-parse.util', () => {
    const ics = buildIcsCalendar({
      calendarName: 'School',
      events: [
        allDayEvent({ startDate: '2026-03-26', endDate: '2026-03-26', name: 'Independence Day' }),
      ],
      now: NOW,
    });
    const parsed = parseIcsEvents(ics);
    expect(parsed).toEqual([
      { date: '2026-03-26', end_date: '2026-03-26', name: 'Independence Day' },
    ]);
  });
});
