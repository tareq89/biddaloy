import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { STUDY_PLAN_CSV_COLUMNS, STUDY_PLAN_LIMITS } from '@biddaloy/shared';

// Cloned from homework/homework-bulk-upload.parser.ts — same ExcelJS-based
// .xlsx/.csv parsing, with the study-plan column schema (66.1.01 / D4).
export const REQUIRED_HEADERS = ['title', 'periods'] as const;
export type StudyPlanCsvHeader = (typeof STUDY_PLAN_CSV_COLUMNS)[number];

export class StudyPlanParseError extends Error {}

export interface ParsedLessonRow {
  /** 1-based row in the sheet (header = 1). */
  rowNumber: number;
  values: Record<StudyPlanCsvHeader, string>;
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

async function loadWorksheet(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet> {
  const ext = extensionOf(filename);
  const workbook = new ExcelJS.Workbook();
  if (ext === '.xlsx') {
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new StudyPlanParseError('Could not read file — is it a valid Excel file?');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new StudyPlanParseError('Could not read file — is it a valid Excel file?');
    return sheet;
  }
  if (ext === '.csv') {
    try {
      return await workbook.csv.read(Readable.from(buffer), { map: (datum: string) => datum });
    } catch {
      throw new StudyPlanParseError('Could not read file — is it a valid CSV file?');
    }
  }
  throw new StudyPlanParseError(`Unsupported file type: ${ext || '(none)'} — upload .xlsx or .csv`);
}

function cellToString(value: ExcelJS.CellValue): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (value instanceof Date) text = value.toISOString().slice(0, 10);
  else if (typeof value === 'object') {
    const obj = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(obj.richText)) text = obj.richText.map((p) => p.text).join('');
    else if ('result' in obj) text = String(obj.result ?? '');
    else if ('text' in obj) text = String(obj.text ?? '');
    else text = String(value);
  } else text = String(value);
  // The exporter writes a UTF-8 BOM; it lands on the first header cell.
  return text.replace(/^﻿/, '').trim();
}

/**
 * The exporter prefixes a `'` to a cell that starts with `=`, `+`, `-`, `@`
 * (formula guard, `csvCell`). Undo it so export → import round-trips.
 */
export function unguardCell(text: string): string {
  return text.replace(/^'(?=[=+\-@\t\r])/, '');
}

/** Parses an uploaded .xlsx/.csv into raw string rows. Row order = lesson order. */
export async function parseLessonSheet(
  buffer: Buffer,
  filename: string,
): Promise<ParsedLessonRow[]> {
  const sheet = await loadWorksheet(buffer, filename);
  const columnIndex = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    columnIndex.set(cellToString(cell.value).toLowerCase(), col);
  });
  const missing = REQUIRED_HEADERS.filter((h) => !columnIndex.has(h));
  if (missing.length > 0) {
    throw new StudyPlanParseError(`Missing required columns: ${missing.join(', ')}`);
  }

  const rows: ParsedLessonRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const values = {} as Record<StudyPlanCsvHeader, string>;
    let any = false;
    for (const header of STUDY_PLAN_CSV_COLUMNS) {
      const col = columnIndex.get(header);
      const text = col === undefined ? '' : unguardCell(cellToString(row.getCell(col).value));
      values[header] = text;
      if (text !== '') any = true;
    }
    if (any) rows.push({ rowNumber, values });
  }

  if (rows.length === 0) throw new StudyPlanParseError('File contains no data rows');
  if (rows.length > STUDY_PLAN_LIMITS.maxLessons) {
    throw new StudyPlanParseError(
      `File has too many rows (max ${STUDY_PLAN_LIMITS.maxLessons} lessons)`,
    );
  }
  return rows;
}
