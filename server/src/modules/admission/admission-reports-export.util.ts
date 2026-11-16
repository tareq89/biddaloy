import ExcelJS from 'exceljs';

export type ExportCell = string | number | null;

/**
 * Spreadsheet formula-injection guard: exceljs already writes JS strings as text cells, but a
 * file converted to CSV or pasted elsewhere would run `=...`, so text that could start a
 * formula gets a leading quote. Numbers stay numbers.
 */
export function safeCell(v: ExportCell): ExportCell {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildExportWorkbook(
  sheetName: string,
  headers: string[],
  rows: ExportCell[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) sheet.addRow(r.map(safeCell));
  sheet.columns.forEach((c) => (c.width = 18));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
