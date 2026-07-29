import ExcelJS from 'exceljs';
import { Readable } from 'stream';

export const REQUIRED_HEADERS = [
  'student_name',
  'class',
  'section',
  'roll',
  'registration_number',
  'guardian1_name',
  'guardian1_phone',
  'guardian1_email',
  'guardian2_name',
  'guardian2_phone',
  'guardian2_email',
  'home_address',
  'preferred_communication',
] as const;

export type BulkUploadHeader = (typeof REQUIRED_HEADERS)[number];

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
      // ExcelJS's default CSV cell mapper coerces numeric-looking values via
      // `Number(datum)` — that silently strips a leading "+" or "0" from
      // phone numbers (e.g. "+8801711111111" -> 8801711111111). Disable it
      // so every cell stays exactly as typed; we parse fields ourselves.
      return await workbook.csv.read(Readable.from(buffer), { map: (datum: string) => datum });
    } catch {
      throw new BulkUploadParseError('Could not read file — is it a valid CSV file?');
    }
  }

  throw new BulkUploadParseError(`Unsupported file type: ${ext || '(none)'} — upload .xlsx or .csv`);
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; result?: unknown };
    if ('text' in obj) return String(obj.text ?? '').trim();
    if ('result' in obj) return String(obj.result ?? '').trim();
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
 * Parses an uploaded .xlsx or .csv buffer against the fixed bulk-upload
 * column schema. Both formats go through the same ExcelJS Worksheet API,
 * so header/row extraction is identical regardless of source format.
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
    for (const header of REQUIRED_HEADERS) {
      const colNumber = columnIndex.get(header) as number;
      values[header] = cellToString(row.getCell(colNumber).value);
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
