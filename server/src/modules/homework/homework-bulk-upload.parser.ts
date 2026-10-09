import ExcelJS from 'exceljs';
import { Readable } from 'stream';

// Cloned from students/bulk-upload.parser.ts — same ExcelJS-based
// .xlsx/.csv parsing, different fixed column schema (D21: section-only
// per row, no per-row grading_mode override).
export const REQUIRED_HEADERS = [
  'class',
  'section',
  'subject',
  'assigned_date',
  'due_date',
] as const;

// description is optional (HomeworkBulkUploadRowDto marks it @IsOptional) —
// a spreadsheet may omit the column entirely rather than including it empty.
export const ALL_HEADERS = [...REQUIRED_HEADERS, 'description'] as const;

export type BulkUploadHeader = (typeof ALL_HEADERS)[number];

export class BulkUploadParseError extends Error {}

const MAX_DATA_ROWS = 2000;

export interface ParsedRow {
  rowNumber: number;
  values: Record<BulkUploadHeader, string>;
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

async function loadWorksheet(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet> {
  const ext = getExtension(filename);
  const workbook = new ExcelJS.Workbook();

  if (ext === '.xlsx') {
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new BulkUploadParseError('Could not read file — is it a valid Excel file?');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BulkUploadParseError('Could not read file — is it a valid Excel file?');
    }
    return worksheet;
  }

  if (ext === '.csv') {
    try {
      return await workbook.csv.read(Readable.from(buffer), { map: (datum: string) => datum });
    } catch {
      throw new BulkUploadParseError('Could not read file — is it a valid CSV file?');
    }
  }

  throw new BulkUploadParseError(
    `Unsupported file type: ${ext || '(none)'} — upload .xlsx or .csv`,
  );
}

/** Excel stores an entered date (e.g. `2026-01-01`) as a date cell, and
 * ExcelJS returns a JS `Date` for it — not a `{ text }`/`{ result }` object
 * and not a string, so it fell straight through to `String(value)`'s
 * locale-dependent, unparseable format. Normalized to `YYYY-MM-DD` here,
 * same for a plain `Date` value and for a formula whose `result` is a
 * `Date`. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    if ('result' in obj) {
      return obj.result instanceof Date
        ? obj.result.toISOString().slice(0, 10)
        : String(obj.result ?? '').trim();
    }
    if ('text' in obj) return String(obj.text ?? '').trim();
  }
  return String(value).trim();
}

function isRowBlank(row: ExcelJS.Row): boolean {
  let hasValue = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cellToString(cell.value) !== '') hasValue = true;
  });
  return !hasValue;
}

/**
 * Parses an uploaded .xlsx or .csv buffer against the fixed homework
 * bulk-upload column schema: class, section, subject, assigned_date,
 * due_date, description.
 */
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedRow[]> {
  const worksheet = await loadWorksheet(buffer, filename);

  const columnIndex = new Map<string, number>();
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    columnIndex.set(cellToString(cell.value), colNumber);
  });

  const missing = REQUIRED_HEADERS.filter((h) => !columnIndex.has(h));
  if (missing.length > 0) {
    throw new BulkUploadParseError(`Missing required columns: ${missing.join(', ')}`);
  }

  const rows: ParsedRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (row.cellCount === 0 || isRowBlank(row)) continue;

    const values = {} as Record<BulkUploadHeader, string>;
    for (const header of ALL_HEADERS) {
      const colNumber = columnIndex.get(header);
      values[header] = colNumber === undefined ? '' : cellToString(row.getCell(colNumber).value);
    }
    rows.push({ rowNumber, values });
  }

  if (rows.length === 0) {
    throw new BulkUploadParseError('File contains no data rows');
  }
  if (rows.length > MAX_DATA_ROWS) {
    throw new BulkUploadParseError(`File has too many rows (max ${MAX_DATA_ROWS})`);
  }

  return rows;
}
