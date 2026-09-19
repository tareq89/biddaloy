import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import type { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';
import type { ParsedCalendarImportRow } from '../dto/calendar-import.dto';

/** Header order the template exports and `validate` expects — both
 * `GET /calendar-import/template` and this file's `CALENDAR_IMPORT_COLUMNS`
 * must stay in lockstep, or a round-tripped template silently parses wrong
 * columns into the wrong fields. */
export const CALENDAR_IMPORT_COLUMNS = [
  'type',
  'name',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'counts_as_working_day',
  'audience',
  'classes',
  'description',
] as const;

export type CalendarImportColumn = (typeof CALENDAR_IMPORT_COLUMNS)[number];

/** One raw spreadsheet row, already unwrapped from its cell format (via
 * `cellText`) into plain strings, keyed by column name. Empty/absent cells
 * are `''`. */
export type RawCalendarImportRow = Record<CalendarImportColumn, string>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^\d{2}:\d{2}(:\d{2})?$/;

/** `DATE_ONLY` only checks shape — "2031-13-45" matches it. Round-trips
 * through `Date.UTC` and compares components back, so an out-of-range
 * date is caught here instead of surfacing later as a 500 when the
 * service layer hands it to Postgres (same fix as `ics-parse.util.ts`'s
 * `toIsoDate`). */
function isRealDate(isoDate: string): boolean {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

/** `TIME_ONLY` only checks shape — "99:99" matches it. */
function isRealTime(hhmm: string): boolean {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours! >= 0 && hours! <= 23 && minutes! >= 0 && minutes! <= 59;
}
const TRUE_WORDS = new Set(['TRUE', 'YES', '1']);
const FALSE_WORDS = new Set(['FALSE', 'NO', '0', '']);

function err(
  row: number,
  column: string | null,
  message: string,
  value?: string,
): BulkImportErrorDto {
  return { row, column, message, severity: 'error', value };
}

/**
 * Validates one raw spreadsheet row in isolation — no database access, no
 * knowledge of other rows, no knowledge of "today". `CalendarImportService`
 * is what turns `class_names` into `class_ids`, matches the row against
 * existing events, and rejects a row whose `end_date` is in the past
 * (past-lock needs the tenant's timezone, which this function doesn't
 * have).
 *
 * Returns `{ row: null, errors }` on any validation failure — a row is
 * either fully valid or fully rejected, there is no partial draft.
 */
export function validateCalendarImportRow(
  raw: RawCalendarImportRow,
  rowNumber: number,
): { row: ParsedCalendarImportRow | null; errors: BulkImportErrorDto[] } {
  const errors: BulkImportErrorDto[] = [];

  const typeRaw = raw.type.trim().toUpperCase();
  if (!Object.values(CalendarEventType).includes(typeRaw as CalendarEventType)) {
    errors.push(
      err(
        rowNumber,
        'type',
        `"type" must be one of ${Object.values(CalendarEventType).join(', ')}`,
        raw.type,
      ),
    );
  }

  const name = raw.name.trim();
  if (name.length === 0) {
    errors.push(err(rowNumber, 'name', '"name" is required'));
  } else if (name.length > 120) {
    errors.push(err(rowNumber, 'name', '"name" must be at most 120 characters', name));
  }

  const startDate = raw.start_date.trim();
  const startDateValid = DATE_ONLY.test(startDate) && isRealDate(startDate);
  if (!startDateValid) {
    errors.push(err(rowNumber, 'start_date', '"start_date" must be YYYY-MM-DD', raw.start_date));
  }

  const endDate = raw.end_date.trim();
  const endDateValid = DATE_ONLY.test(endDate) && isRealDate(endDate);
  if (!endDateValid) {
    errors.push(err(rowNumber, 'end_date', '"end_date" must be YYYY-MM-DD', raw.end_date));
  }

  if (startDateValid && endDateValid && endDate < startDate) {
    errors.push(err(rowNumber, 'end_date', '"end_date" must not be earlier than "start_date"'));
  }

  const startTimeRaw = raw.start_time.trim();
  const startTime = startTimeRaw.length > 0 ? startTimeRaw : null;
  if (startTime !== null && !(TIME_ONLY.test(startTime) && isRealTime(startTime))) {
    errors.push(err(rowNumber, 'start_time', '"start_time" must be HH:mm', raw.start_time));
  }

  const endTimeRaw = raw.end_time.trim();
  const endTime = endTimeRaw.length > 0 ? endTimeRaw : null;
  if (endTime !== null && !(TIME_ONLY.test(endTime) && isRealTime(endTime))) {
    errors.push(err(rowNumber, 'end_time', '"end_time" must be HH:mm', raw.end_time));
  }

  const countsRaw = raw.counts_as_working_day.trim().toUpperCase();
  let countsAsWorkingDay = false;
  if (TRUE_WORDS.has(countsRaw)) {
    countsAsWorkingDay = true;
  } else if (FALSE_WORDS.has(countsRaw)) {
    countsAsWorkingDay = false;
  } else {
    errors.push(
      err(
        rowNumber,
        'counts_as_working_day',
        '"counts_as_working_day" must be TRUE/FALSE (or YES/NO, 1/0)',
        raw.counts_as_working_day,
      ),
    );
  }

  const audienceRaw = raw.audience.trim().toUpperCase();
  let audience = CalendarAudience.ALL;
  if (audienceRaw.length > 0) {
    if (!Object.values(CalendarAudience).includes(audienceRaw as CalendarAudience)) {
      errors.push(
        err(
          rowNumber,
          'audience',
          `"audience" must be one of ${Object.values(CalendarAudience).join(', ')}`,
          raw.audience,
        ),
      );
    } else {
      audience = audienceRaw as CalendarAudience;
    }
  }

  const classNames = raw.classes
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  // Dedupe case-sensitively — two different-case names are two different
  // rows to resolve against the DB, and the DB lookup itself decides
  // whether they match, not this pure validator.
  const uniqueClassNames = Array.from(new Set(classNames));

  const description = raw.description.trim();

  if (errors.length > 0) {
    return { row: null, errors };
  }

  return {
    row: {
      type: typeRaw as CalendarEventType,
      name,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      counts_as_working_day: countsAsWorkingDay,
      audience,
      class_names: uniqueClassNames,
      description: description.length > 0 ? description : null,
    },
    errors: [],
  };
}
