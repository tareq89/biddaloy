/**
 * Minimal ICS (RFC 5545) writer for [17.4.1] — serializes a school's
 * calendar feed for `GET /calendar/feed/:token.ics`. Mirrors
 * `ics-parse.util.ts`'s pure-util shape, just in the write direction:
 * escaping, 75-octet line folding, and CRLF line endings, and nothing more
 * than the properties this feed actually emits.
 */

export interface IcsEventInput {
  /** Stable id used to build `UID = <id>@biddaloy`. */
  id: string;
  name: string;
  description?: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  startDate: string;
  /** `YYYY-MM-DD`, inclusive (converted to ICS's exclusive `DTEND` on
   * write for all-day events). */
  endDate: string;
  /** `HH:MM:SS` or `HH:MM`, or `null`/`undefined` for an all-day event. */
  startTime?: string | null;
  endTime?: string | null;
  /** IANA timezone, e.g. `Asia/Dhaka` — used for `TZID` on timed events. */
  timezone: string;
  /** Epoch seconds — `SEQUENCE`. */
  sequence: number;
  /** `CATEGORIES` value, e.g. the event `type`. */
  category: string;
}

export interface IcsCalendarInput {
  calendarName: string;
  events: IcsEventInput[];
  /** `DTSTAMP` for every VEVENT — when this feed was generated. */
  now?: Date;
}

/** ICS text values escape `\`, `;`, `,` and newlines (RFC 5545 §3.3.11) —
 * the exact inverse of `ics-parse.util.ts`'s `unescapeIcsText`. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** ICS "folds" any line over 75 octets: split it across a continuation
 * line that starts with a single space (RFC 5545 §3.1). Folding is done
 * on UTF-8 byte boundaries so a multi-byte character is never split
 * mid-codepoint. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a UTF-8 continuation byte (0b10xxxxxx) off its lead
    // byte — back off until `end` sits on a codepoint boundary.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
      end -= 1;
    }
    chunks.push(bytes.slice(start, end).toString('utf8'));
    start = end;
    // Every continuation line after the first starts with a folding
    // space, which itself counts toward the 75-octet limit.
    limit = 74;
  }
  return chunks.join('\r\n ');
}

function dateOnlyToIcs(iso: string): string {
  return iso.replace(/-/g, '');
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

/** `HH:MM[:SS]` → `HHMMSS`. */
function timeToIcs(time: string): string {
  const [h, m, s] = time.split(':');
  return `${(h ?? '00').padStart(2, '0')}${(m ?? '00').padStart(2, '0')}${(s ?? '00').padStart(2, '0')}`;
}

function timestampToIcs(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function buildVevent(event: IcsEventInput, now: Date): string[] {
  const isAllDay = !event.startTime || !event.endTime;
  const lines: string[] = [];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${event.id}@biddaloy`);
  lines.push(`DTSTAMP:${timestampToIcs(now)}`);

  if (isAllDay) {
    // ICS all-day `DTEND` is exclusive — one day past our own inclusive
    // `endDate`, matching `ics-parse.util.ts`'s read-side convention in
    // reverse.
    lines.push(`DTSTART;VALUE=DATE:${dateOnlyToIcs(event.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${dateOnlyToIcs(addDaysIso(event.endDate, 1))}`);
  } else {
    lines.push(
      `DTSTART;TZID=${event.timezone}:${dateOnlyToIcs(event.startDate)}T${timeToIcs(event.startTime!)}`,
    );
    lines.push(
      `DTEND;TZID=${event.timezone}:${dateOnlyToIcs(event.endDate)}T${timeToIcs(event.endTime!)}`,
    );
  }

  lines.push(`SUMMARY:${escapeIcsText(event.name)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  lines.push(`SEQUENCE:${event.sequence}`);
  lines.push(`CATEGORIES:${escapeIcsText(event.category)}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Serializes a `VCALENDAR` document: `PRODID`, `X-WR-CALNAME`, and one
 * `VEVENT` per input event. Every line is folded at 75 octets and joined
 * with CRLF, per RFC 5545.
 */
export function buildIcsCalendar(input: IcsCalendarInput): string {
  const now = input.now ?? new Date();
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Biddaloy//Calendar Feed//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push(`X-WR-CALNAME:${escapeIcsText(input.calendarName)}`);

  for (const event of input.events) {
    lines.push(...buildVevent(event, now));
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
