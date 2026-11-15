import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildExportWorkbook, safeCell } from './admission-reports-export.util';

describe('admission export workbook', () => {
  it('escapes formula starters and keeps numbers numeric', async () => {
    expect(safeCell('=1+1')).toBe("'=1+1");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('Rahim')).toBe('Rahim');
    expect(safeCell(null)).toBeNull();
    const buf = await buildExportWorkbook('s', ['name', 'score'], [['=cmd', 42.5]]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const row = wb.getWorksheet('s')!.getRow(2);
    expect(row.getCell(1).value).toBe("'=cmd");
    expect(row.getCell(2).value).toBe(42.5);
  });
});
