/**
 * Minimal ICS (RFC 5545) VEVENT parser for [17.2.4] — pulls only the three
 * fields `PublicHolidayFetchService` needs (`DTSTART`, `DTEND`, `SUMMARY`)
 * out of a Google-published holiday calendar feed. Everything else in the
 * file (VALARM, VTIMEZONE, RRULE, ...) is ignored on purpose: this is not a
 * general ICS library, just enough to read a public-holiday feed.
 */

export interface ParsedIcsEvent {
  /** Inclusive start date, `YYYY-MM-DD`. */
  date: string;
  /** Inclusive end date, `YYYY-MM-DD`. A single-day holiday has
   * `end_date === date`. */
  end_date: string;
  name: string;
}

/** ICS "folds" long lines: a continuation line starts with a single space
 * or tab and must be joined onto the previous line with the fold removed
 * before parsing property values (RFC 5545 §3.1). */
function unfold(raw: string): string[] {
  const rawLines = raw.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** `DTSTART;VALUE=DATE:20260101` → `20260101`. Only the bare `YYYYMMDD`
 * all-day form is supported — a timed `DTSTART` (with a `T...Z` suffix) is
 * not something a public-holiday feed uses, so it's left unparsed
 * (`toIsoDate` below would throw on it, which surfaces as a skipped
 * event rather than a wrong date). */
function propValue(line: string): { name: string; value: string } | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const left = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1).trim();
  const name = left.split(';')[0]?.trim().toUpperCase();
  if (!name) return null;
  return { name, value };
}

function toIsoDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) {
    throw new Error(`Not a bare YYYYMMDD date: "${yyyymmdd}"`);
  }
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` normalizes out-of-range components (e.g. month 13, day 30 of
  // February) instead of throwing — round-trip through it and compare, so a
  // feed entry like "20260230" is rejected rather than silently becoming
  // a real (wrong) date.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Not a real calendar date: "${yyyymmdd}"`);
  }
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Parses every `VEVENT` in an ICS document into `{ date, end_date, name }`.
 * `DTEND` in ICS is exclusive (the event runs up to, not including, that
 * date), so a multi-day holiday's `end_date` here is `DTEND - 1 day` to
 * make it inclusive like the rest of this codebase's date ranges. A
 * `VEVENT` missing `DTSTART` or `SUMMARY` is skipped rather than throwing —
 * one malformed entry in an externally-sourced feed shouldn't fail the
 * whole fetch.
 */
export function parseIcsEvents(raw: string): ParsedIcsEvent[] {
  const lines = unfold(raw);
  const events: ParsedIcsEvent[] = [];

  let inEvent = false;
  // Depth of nested components (VALARM, etc.) inside the current VEVENT —
  // a property is only read at depth 0, so a VALARM's own SUMMARY can't
  // overwrite the holiday's actual name.
  let nestedDepth = 0;
  let dtstart: string | null = null;
  let dtend: string | null = null;
  let summary: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      nestedDepth = 0;
      dtstart = null;
      dtend = null;
      summary = null;
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      inEvent = false;
      if (dtstart && summary) {
        try {
          const startIso = toIsoDate(dtstart);
          const endIso = dtend ? addDaysIso(toIsoDate(dtend), -1) : startIso;
          events.push({ date: startIso, end_date: endIso, name: summary });
        } catch {
          // Malformed date on this VEVENT — skip it, keep parsing the rest.
        }
      }
      continue;
    }
    if (!inEvent) continue;

    if (trimmed.startsWith('BEGIN:')) {
      nestedDepth += 1;
      continue;
    }
    if (trimmed.startsWith('END:')) {
      nestedDepth = Math.max(0, nestedDepth - 1);
      continue;
    }
    if (nestedDepth > 0) continue;

    const prop = propValue(trimmed);
    if (!prop) continue;

    if (prop.name === 'DTSTART') dtstart = prop.value;
    else if (prop.name === 'DTEND') dtend = prop.value;
    else if (prop.name === 'SUMMARY') summary = unescapeIcsText(prop.value);
  }

  return events;
}

/** ICS text values escape `\,`, `\;`, `\\` and `\n` (RFC 5545 §3.3.11). */
function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}
