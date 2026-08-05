import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseSpreadsheet,
  BulkUploadParseError,
  REQUIRED_HEADERS,
  BulkUploadHeader,
} from './bulk-upload.parser';

/**
 * Unit tests for the pure spreadsheet parser (no DB involved).
 * Fixtures are built in-memory with ExcelJS rather than committed files,
 * so the exact schema under test always matches REQUIRED_HEADERS.
 */

const DEFAULTS: Record<BulkUploadHeader, string> = {
  student_name: 'Alice Rahman',
  class: 'Class One',
  section: 'A',
  roll: '1',
  registration_number: '',
  guardian1_name: 'Bob Rahman',
  guardian1_phone: '+8801711111111',
  guardian1_email: '',
  guardian2_name: '',
  guardian2_phone: '',
  guardian2_email: '',
  home_address: '',
  preferred_communication: '',
};

function rowValues(
  headers: readonly string[],
  overrides: Partial<Record<BulkUploadHeader, string>> = {},
): string[] {
  const merged = { ...DEFAULTS, ...overrides };
  return headers.map((h) => merged[h as BulkUploadHeader] ?? '');
}

async function buildXlsxBuffer(headers: string[], rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function buildCsvBuffer(headers: string[], rows: string[][]): Buffer {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return Buffer.from(lines.join('\n'), 'utf-8');
}

describe('parseSpreadsheet', () => {
  it('parses a valid .xlsx into rows keyed by the fixed header schema', async () => {
    const headers = [...REQUIRED_HEADERS];
    const buffer = await buildXlsxBuffer(headers, [rowValues(headers)]);

    const rows = await parseSpreadsheet(buffer, 'students.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].values.student_name).toBe('Alice Rahman');
    expect(rows[0].values.guardian1_phone).toBe('+8801711111111');
  });

  it('parses a valid .csv to the same shape as the equivalent .xlsx', async () => {
    const headers = [...REQUIRED_HEADERS];
    const data = [rowValues(headers, { student_name: 'Csv Student' })];
    const xlsxBuffer = await buildXlsxBuffer(headers, data);
    const csvBuffer = buildCsvBuffer(headers, data);

    const xlsxRows = await parseSpreadsheet(xlsxBuffer, 'students.xlsx');
    const csvRows = await parseSpreadsheet(csvBuffer, 'students.csv');

    expect(csvRows).toHaveLength(1);
    expect(csvRows[0].values).toEqual(xlsxRows[0].values);
  });

  it('throws a specific error listing missing required columns', async () => {
    const headers = REQUIRED_HEADERS.filter((h) => h !== 'guardian1_phone' && h !== 'section');
    const buffer = await buildXlsxBuffer([...headers], [rowValues(headers)]);

    await expect(parseSpreadsheet(buffer, 'students.xlsx')).rejects.toThrow(BulkUploadParseError);
    await expect(parseSpreadsheet(buffer, 'students.xlsx')).rejects.toThrow(
      'Missing required columns: section, guardian1_phone',
    );
  });

  it('throws when the file has no data rows', async () => {
    const headers = [...REQUIRED_HEADERS];
    const buffer = await buildXlsxBuffer(headers, []);

    await expect(parseSpreadsheet(buffer, 'students.xlsx')).rejects.toThrow(
      'File contains no data rows',
    );
  });

  it('skips fully blank rows without counting them as data', async () => {
    const headers = [...REQUIRED_HEADERS];
    const blankRow = headers.map(() => '');
    const buffer = await buildXlsxBuffer(headers, [
      rowValues(headers),
      blankRow,
      rowValues(headers, { student_name: 'Third Row' }),
    ]);

    const rows = await parseSpreadsheet(buffer, 'students.xlsx');

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it('rejects an unsupported file extension', async () => {
    const buffer = Buffer.from('not a spreadsheet');

    await expect(parseSpreadsheet(buffer, 'students.pdf')).rejects.toThrow(
      'Unsupported file type: .pdf — upload .xlsx or .csv',
    );
  });

  it('rejects a corrupt .xlsx buffer with a clear message', async () => {
    const buffer = Buffer.from('this is not a real xlsx file');

    await expect(parseSpreadsheet(buffer, 'students.xlsx')).rejects.toThrow(
      'Could not read file — is it a valid Excel file?',
    );
  });

  it('rejects a file with more than the row limit', async () => {
    const headers = [...REQUIRED_HEADERS];
    const rows = Array.from({ length: 2001 }, (_, i) =>
      rowValues(headers, { student_name: `Student ${i}`, roll: String(i + 1) }),
    );
    const buffer = await buildXlsxBuffer(headers, rows);

    await expect(parseSpreadsheet(buffer, 'students.xlsx')).rejects.toThrow(
      'File has too many rows (max 2000)',
    );
  }, 20000);

  it('trims whitespace from cell values', async () => {
    const headers = [...REQUIRED_HEADERS];
    const buffer = await buildXlsxBuffer(headers, [
      rowValues(headers, { student_name: '  Padded Name  ' }),
    ]);

    const rows = await parseSpreadsheet(buffer, 'students.xlsx');

    expect(rows[0].values.student_name).toBe('Padded Name');
  });
});
