/**
 * CSV escaping shared by every producer of a downloadable report, client or
 * server. Previously this lived only in `ui/src/utils/csv.ts`; the backup
 * validation report added a server-side producer, and a second
 * implementation there shipped without the formula guard or the BOM.
 * Escaping is sanitisation, and sanitisation is this package's job.
 */

/**
 * A value starting with `=`, `+`, `-`, `@`, or a tab/CR is a formula to
 * spreadsheet software (Excel, Sheets) — a guardian name like
 * `=HYPERLINK(...)` would execute on open. Prefixing with `'` forces it to
 * render as text instead, same as Excel's own CSV-injection guidance.
 */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * One quoted, injection-guarded CSV cell. `null`/`undefined` become an empty
 * cell rather than the literal strings "null"/"undefined".
 */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : // eslint-disable-next-line @typescript-eslint/no-base-to-string -- numbers/booleans stringify fine; an object caller passed is their bug to see in the file
          String(value);
  if (CSV_FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Rows (header first) → a single CRLF-joined, BOM-prefixed CSV string.
 *
 * Excel on Windows decodes a BOM-less CSV using the system code page,
 * mangling non-Latin text (e.g. Bangla names) — the UTF-8 BOM makes it read
 * the file as UTF-8 instead. CRLF is what Excel expects as a row separator.
 */
export function toCsvContent(rows: readonly (readonly unknown[])[]): string {
  const body = rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n');
  return `﻿${body}`;
}
