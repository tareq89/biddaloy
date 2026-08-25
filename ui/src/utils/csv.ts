/**
 * Shared CSV helpers — extracted from the two identical copies that lived
 * in `client-admin`'s `fees/dues.tsx` and `students/index.tsx` once the
 * student-import error report became the third caller (the repo's "a
 * third use earns extraction" convention).
 */

/** A value starting with `=`, `+`, `-`, `@`, or a tab/CR is a formula to
 * spreadsheet software (Excel, Sheets) — a guardian name like
 * `=HYPERLINK(...)` would execute on open. Prefixing with `'` forces it
 * to render as text instead, same as Excel's own CSV-injection guidance. */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** One quoted, injection-guarded CSV cell. `null`/`undefined` become an
 * empty cell rather than the literal strings "null"/"undefined". */
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

/** Rows (header first) → a single CRLF-joined, BOM-prefixed CSV string.
 * Excel on Windows decodes a BOM-less CSV using the system code page,
 * mangling non-Latin text (e.g. Bangla names) — the UTF-8 BOM makes it
 * read the file as UTF-8 instead. */
export function toCsvContent(rows: readonly (readonly unknown[])[]): string {
  const body = rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n');
  return `\uFEFF${body}`;
}

/** Builds the CSV client-side and hands it to the browser as a download —
 * no server endpoint involved.
 *
 * The anchor is attached to the document before clicking (Firefox ignores a
 * click on a detached anchor) and the object URL is revoked on a later tick
 * (Safari aborts an in-flight download if it is revoked in the same one). */
export function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]): void {
  const blob = new Blob([toCsvContent(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
