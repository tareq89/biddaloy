import ExcelJS from 'exceljs';
import { cellText } from '../../workbook/codec/cell-format';
import { CALENDAR_IMPORT_COLUMNS, RawCalendarImportRow } from './calendar-import-rows.util';
import { CalendarEventType, toCsvContent } from '@biddaloy/shared';

export class CalendarImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarImportFileError';
  }
}

/** Two example rows the template ships with, so an admin sees the expected
 * shape rather than an empty header row. */
const EXAMPLE_ROWS: RawCalendarImportRow[] = [
  {
    type: CalendarEventType.HOLIDAY,
    name: 'Independence Day',
    start_date: '2026-03-26',
    end_date: '2026-03-26',
    start_time: '',
    end_time: '',
    counts_as_working_day: 'FALSE',
    audience: 'ALL',
    classes: '',
    description: 'National holiday',
  },
  {
    type: CalendarEventType.EXAM,
    name: 'Mid-term exam',
    start_date: '2026-04-10',
    end_date: '2026-04-12',
    start_time: '09:00',
    end_time: '12:00',
    counts_as_working_day: 'TRUE',
    audience: 'ALL',
    classes: 'Class 8, Class 9',
    description: '',
  },
];

function rowToCells(row: RawCalendarImportRow): string[] {
  return CALENDAR_IMPORT_COLUMNS.map((column) => row[column]);
}

/** Builds the `.xlsx` template — header row plus two example rows. */
export async function buildCalendarImportXlsxTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('calendar-import');
  sheet.addRow([...CALENDAR_IMPORT_COLUMNS]);
  for (const example of EXAMPLE_ROWS) {
    sheet.addRow(rowToCells(example));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** One RFC-4180 CSV cell: quoted fields may contain commas, CRLF, and `""`
 * as an escaped quote. */
function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Strip a leading UTF-8 BOM, if present (this repo's own CSV writer,
  // `toCsvContent`, always adds one).
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  // Final field/row, if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Builds the `.csv` template — header row plus two example rows. */
export function buildCalendarImportCsvTemplate(): string {
  const rows = [[...CALENDAR_IMPORT_COLUMNS], ...EXAMPLE_ROWS.map(rowToCells)];
  return toCsvContent(rows);
}

function cellsToRawRow(cells: string[]): RawCalendarImportRow {
  const raw = {} as RawCalendarImportRow;
  CALENDAR_IMPORT_COLUMNS.forEach((column, index) => {
    raw[column] = (cells[index] ?? '').trim();
  });
  return raw;
}

/** Parses an uploaded `.xlsx` or `.csv` buffer's first sheet into raw rows,
 * keyed by `CALENDAR_IMPORT_COLUMNS` (matched by header text, not
 * position — a re-ordered template still parses correctly). Throws
 * `CalendarImportFileError` on anything that isn't a readable sheet with a
 * recognisable header row. */
export async function parseCalendarImportFile(
  buffer: Buffer,
  filename: string,
): Promise<RawCalendarImportRow[]> {
  const isCsv = filename.toLowerCase().endsWith('.csv');
  const isXlsx = filename.toLowerCase().endsWith('.xlsx');
  if (!isCsv && !isXlsx) {
    throw new CalendarImportFileError('Only .xlsx or .csv files are accepted.');
  }

  let rows: string[][];
  if (isCsv) {
    rows = parseCsvLines(buffer.toString('utf8'));
  } else {
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs's own `.d.ts` for `load` predates the `Buffer<ArrayBufferLike>`
      // generic Node's current lib.d.ts uses — same workaround
      // `workbook-codec.ts` applies for this exact call.
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new CalendarImportFileError('The uploaded file is not a valid .xlsx workbook.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new CalendarImportFileError('The uploaded workbook has no sheets.');
    }
    rows = [];
    sheet.eachRow((sheetRow) => {
      const cells: string[] = [];
      // ExcelJS rows are 1-indexed and sparse — `eachCell` with
      // `includeEmpty: true` up to the header's own column count keeps
      // every column aligned even when a trailing cell is blank.
      sheetRow.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cellText(cell.value));
      });
      rows.push(cells);
    });
  }

  if (rows.length === 0) {
    throw new CalendarImportFileError('The uploaded file has no rows.');
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const columnIndex = CALENDAR_IMPORT_COLUMNS.map((column) => header.indexOf(column));
  if (columnIndex.some((index) => index === -1)) {
    throw new CalendarImportFileError(
      `Header row must contain columns: ${CALENDAR_IMPORT_COLUMNS.join(', ')}`,
    );
  }

  return rows.slice(1).map((cells) => {
    const reordered = columnIndex.map((index) => cells[index] ?? '');
    return cellsToRawRow(reordered);
  });
}
