import type { ColumnSpec, ColumnType, RowError } from './tab-spec';

/**
 * The single authority on how a typed value becomes a spreadsheet cell and
 * how a cell becomes a typed value again.
 *
 * Nothing else in the workbook codec formats or parses a cell. That matters
 * most for money: this module treats amounts as *decimal strings* end to
 * end and never converts them to a JS number, so a fee of `10.10` cannot
 * come back as `10.099999999999999`. No float conversion appears anywhere in
 * this file, and `cell-format.spec.ts` enforces that by reading this source
 * with comments stripped.
 */

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/** exceljs hands back a v4 uuid; anything else is a foreign id we reject. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MONEY = /^-?\d+(\.\d{1,2})?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INTEGER = /^-?\d+$/;

const TRUE_WORDS = new Set(['TRUE', 'YES', '1']);
const FALSE_WORDS = new Set(['FALSE', 'NO', '0']);

/**
 * Formats an amount to exactly two decimal places using string operations
 * only.
 *
 * Accepts what a TypeORM `decimal`/`numeric` column yields (a string such as
 * `'10.1'` or `'1500.00'`). A `number` is tolerated only when it is an
 * integer, because an integer has an exact decimal representation; a
 * non-integer `number` has already lost precision before reaching us and is
 * rejected rather than silently rounded.
 */
function formatMoney(value: string | number): string {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new TypeError(
      `Cannot format ${value} as money: a non-integer number has already lost precision. ` +
        `Pass the decimal string from the database instead.`,
    );
  }

  const raw = typeof value === 'number' ? String(value) : value.trim();

  if (!MONEY.test(raw)) {
    throw new TypeError(
      `Cannot format "${raw}" as money: expected a plain decimal string such as "1500.00".`,
    );
  }

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = digits.split('.');
  const padded = (fraction + '00').slice(0, 2);

  // `-0.00` is not a meaningful amount; normalise it to `0.00`.
  const body = `${whole}.${padded}`;
  return negative && /^0+\.00$/.test(body) ? '0.00' : `${negative ? '-' : ''}${body}`;
}

/**
 * Formats a calendar date with no time and no timezone conversion.
 *
 * node-postgres parses a Postgres `date` column into a JS `Date` at **local**
 * midnight, so `toISOString()` would convert that instant to UTC and shift
 * the day backwards for any server east of Greenwich — in Asia/Dhaka
 * (UTC+6), an academic year starting 2026-03-09 would export as 2026-03-08.
 * Reading the local calendar components instead keeps the date the database
 * meant, whatever `TZ` the server runs under.
 */
function formatDateOnly(value: unknown): string {
  // An already-ISO string needs no interpretation at all.
  if (typeof value === 'string') {
    const parts = DATE_ONLY.exec(value.trim());
    if (parts) return `${parts[1]}-${parts[2]}-${parts[3]}`;
  }

  const date = toDate(value);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new TypeError(`Cannot format ${JSON.stringify(value)} as a date.`);
}

/**
 * Turns a typed value into the cell exceljs should write.
 *
 * `null`/`undefined` always become `null` (an empty cell) regardless of
 * type, so an optional column round-trips through an empty cell.
 */
export function toCell(type: ColumnType, value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;

  switch (type) {
    case 'money':
      return formatMoney(value as string | number);

    case 'date':
      return formatDateOnly(value);

    case 'datetime':
      return toDate(value).toISOString();

    case 'bool':
      return value ? 'TRUE' : 'FALSE';

    case 'int': {
      // Written as a real number so the cell sorts and filters as one.
      if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
          throw new TypeError(`Cannot format ${value} as an int.`);
        }
        return value;
      }
      const text = String(value).trim();
      // Validated before conversion: parseInt('42.9') would silently yield
      // 42 and parseInt('12abc') would yield 12, exporting a plausible but
      // wrong number instead of surfacing the bad value.
      if (!INTEGER.test(text)) {
        throw new TypeError(`Cannot format ${JSON.stringify(value)} as an int.`);
      }
      return globalThis.parseInt(text, 10);
    }

    case 'json':
      return JSON.stringify(value);

    case 'ref-list':
      return (Array.isArray(value) ? value : [value]).map((v) => String(v)).join(';');

    case 'uuid':
    case 'string':
    case 'enum':
    case 'ref':
    default:
      return String(value);
  }
}

/**
 * Cleans one raw exceljs cell value into a plain string.
 *
 * Deliberately **column-type-blind**: the signature takes no `ColumnSpec`,
 * so this does only what can be done without knowing the target type —
 * unwrap exceljs's object cell shapes, trim, collapse inner whitespace, and
 * map Bengali digits to ASCII. The "Excel serial number in a date column"
 * case named in the ticket needs the column type to know a bare number is a
 * date rather than an amount, so it lives in {@link fromCell}'s date branch
 * instead.
 *
 * Bengali digits are mapped unconditionally, including inside free text. The
 * alternative — mapping only in numeric columns — would require the column
 * type this function does not have, and a Bengali-digit run inside a school
 * name is far rarer than a Bengali-digit phone number or amount, which is
 * the case this exists for.
 */
/**
 * Unwraps a raw exceljs cell to plain text and trims it — nothing more.
 *
 * Used where the value is prose rather than data: `_meta` values such as
 * `source_school_name`. Running the full {@link normalizeCell} there would
 * rewrite a Bangla school name like `৫ নম্বর সরকারি বিদ্যালয়` to
 * `5 নম্বর সরকারি বিদ্যালয়`, silently corrupting the provenance a user is
 * shown at restore time.
 */
export function cellText(raw: unknown): string {
  return extractText(raw).trim();
}

export function normalizeCell(raw: unknown): string {
  return normalizeDigits(extractText(raw)).trim().replace(/\s+/g, ' ');
}

/**
 * Maps Bengali digits `০১২৩৪৫৬৭৮৯` to ASCII and collapses whitespace.
 *
 * Applied by {@link fromCell} only to the column types where a digit is a
 * digit — money, int, date, datetime. It must **not** be applied to prose:
 * a school named `৫ নম্বর সরকারি বিদ্যালয়` would become
 * `5 নম্বর সরকারি বিদ্যালয়`, and an address would lose its line breaks.
 */
export function normalizeDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const bengali = BENGALI_DIGITS.indexOf(char);
    out += bengali === -1 ? char : String(bengali);
  }
  return out;
}

function extractText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  if (raw instanceof Date) return raw.toISOString();

  if (typeof raw === 'object') {
    const cell = raw as Record<string, unknown>;

    // Rich text: { richText: [{ text: 'a' }, { text: 'b' }] }
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => String((part as { text?: unknown }).text ?? '')).join('');
    }

    // Formula cell: { formula: 'A1+1', result: 42 }
    if ('result' in cell) return extractText(cell.result);

    // Hyperlink cell: { text: 'Click', hyperlink: 'https://…' }
    if ('text' in cell) return extractText(cell.text);

    // Error cell: { error: '#REF!' }
    if ('error' in cell) return String(cell.error);
  }

  return String(raw);
}

/** Builds a RowError that always names the column and shows the value. */
function err(
  col: ColumnSpec,
  tab: string,
  rowNo: number,
  raw: string,
  message: string,
): { error: RowError } {
  return {
    error: {
      tab,
      row: rowNo,
      column: col.key,
      message: `Column "${col.key}": ${message}`,
      severity: 'error',
      value: raw,
    },
  };
}

/**
 * Validates and converts one normalized cell string against its column spec.
 *
 * Returns a `RowError` rather than throwing, so one bad cell costs the user
 * that cell and not the other 4,000 good rows.
 */
export function fromCell(
  col: ColumnSpec,
  raw: string,
  tab: string,
  rowNo: number,
): { value: unknown } | { error: RowError } {
  // Digit mapping and whitespace collapsing happen here, per column type,
  // rather than in `normalizeCell` — a Bengali digit is only a digit in a
  // numeric or date column. In a school name it is part of the name, and
  // rewriting it would silently corrupt the record.
  const numeric =
    col.type === 'money' || col.type === 'int' || col.type === 'date' || col.type === 'datetime';
  const text = numeric ? normalizeDigits(raw).trim().replace(/\s+/g, ' ') : raw.trim();

  if (text === '') {
    if (col.required) {
      return err(col, tab, rowNo, raw, 'is required but the cell is empty.');
    }
    // An empty list is an empty list, not a missing value: `toCell` writes
    // `[]` as an empty cell, so returning null here would break the
    // round-trip and hand `upsert` a null where it iterates.
    return { value: col.type === 'ref-list' ? [] : null };
  }

  switch (col.type) {
    case 'uuid':
      if (!UUID_V4.test(text)) {
        return err(col, tab, rowNo, raw, `"${text}" is not a v4 UUID.`);
      }
      return { value: text.toLowerCase() };

    case 'money':
      if (!MONEY.test(text)) {
        return err(
          col,
          tab,
          rowNo,
          raw,
          `"${text}" is not a valid amount. Use digits with at most two decimal places, ` +
            `for example 1500 or 1500.50.`,
        );
      }
      // Stays a string: converting here would reintroduce float error.
      return { value: formatMoney(text) };

    case 'int':
      if (!INTEGER.test(text)) {
        return err(col, tab, rowNo, raw, `"${text}" is not a whole number.`);
      }
      return { value: globalThis.parseInt(text, 10) };

    case 'bool': {
      const upper = text.toUpperCase();
      if (TRUE_WORDS.has(upper)) return { value: true };
      if (FALSE_WORDS.has(upper)) return { value: false };
      return err(col, tab, rowNo, raw, `"${text}" is not a yes/no value. Use TRUE or FALSE.`);
    }

    case 'enum': {
      const allowed = col.enumValues ?? [];
      if (!allowed.includes(text)) {
        return err(
          col,
          tab,
          rowNo,
          raw,
          `"${text}" is not one of the allowed values: ${allowed.join(', ')}.`,
        );
      }
      return { value: text };
    }

    case 'date':
      return parseDateCell(col, text, tab, rowNo, raw, false);

    case 'datetime':
      return parseDateCell(col, text, tab, rowNo, raw, true);

    case 'json':
      try {
        return { value: JSON.parse(text) };
      } catch {
        return err(col, tab, rowNo, raw, `"${text}" is not valid JSON.`);
      }

    case 'ref-list':
      return {
        value: text
          .split(';')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      };

    case 'ref':
    case 'string':
    default:
      return { value: text };
  }
}

/**
 * Excel's day-zero. A workbook cell formatted as a date but read as a raw
 * number arrives as days since 1899-12-30 (Lotus-compatible, which is why it
 * is the 30th and not the 31st).
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

function parseDateCell(
  col: ColumnSpec,
  text: string,
  tab: string,
  rowNo: number,
  raw: string,
  withTime: boolean,
): { value: unknown } | { error: RowError } {
  // An Excel serial date: this is the column-type-aware case normalizeCell
  // cannot handle, since a bare number is only a date because *this* column
  // says so.
  if (INTEGER.test(text)) {
    const serial = globalThis.parseInt(text, 10);
    // Bounded to Excel's own range (1 = 1900-01-01, 2958465 = 9999-12-31).
    // Without this, a human typing a compact date like `20260309` becomes
    // the year +057370, and a larger number makes `toISOString()` raise a
    // RangeError that would escape fromCell and abort the whole import —
    // the opposite of the one-RowError-per-bad-cell contract.
    if (serial < 1 || serial > 2958465) {
      return err(
        col,
        tab,
        rowNo,
        raw,
        `"${text}" is not a date. Use YYYY-MM-DD rather than a bare number.`,
      );
    }
    const date = new Date(EXCEL_EPOCH_UTC + serial * MS_PER_DAY);
    return { value: withTime ? date.toISOString() : date.toISOString().slice(0, 10) };
  }

  if (!withTime) {
    const parts = DATE_ONLY.exec(text);
    if (!parts) {
      return err(col, tab, rowNo, raw, `"${text}" is not a date. Use YYYY-MM-DD.`);
    }

    const [, year, month, day] = parts;
    const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

    // `new Date('2026-02-30')` rolls over to March 2 rather than failing, so
    // the only way to reject an impossible calendar date is to compare the
    // parsed components back against what was written.
    const roundTrips =
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() + 1 === Number(month) &&
      date.getUTCDate() === Number(day);

    if (!roundTrips) {
      return err(col, tab, rowNo, raw, `"${text}" is not a real calendar date.`);
    }

    return { value: `${year}-${month}-${day}` };
  }

  // A timestamp with no zone (`2026-03-09 10:00:00`, which Sheets and CSV
  // exports produce routinely) is parsed by `new Date` in the *server's*
  // timezone and then re-emitted as UTC, silently shifting it by the host
  // offset. Backups must not depend on where they were restored, so a
  // zone-less timestamp is read as UTC explicitly.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const normalized = hasZone ? text : `${text.replace(' ', 'T')}Z`;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return err(col, tab, rowNo, raw, `"${text}" is not a date and time. Use an ISO timestamp.`);
  }

  // A date-only string reaching the datetime branch must still be a real
  // calendar date; `new Date` rolls impossible days over silently.
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly && date.getUTCDate() !== Number(dateOnly[3])) {
    return err(col, tab, rowNo, raw, `"${text}" is not a real calendar date.`);
  }

  return { value: date.toISOString() };
}
