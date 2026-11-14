import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { ImportFileErrorCode } from '@biddaloy/shared';
import type { ImportFileError } from '../errors/import-file.error';
import {
  assertXlsxWithinLimits,
  XLSX_TOO_LARGE_MESSAGE,
  XlsxTooLargeError,
} from './xlsx-guard.util';

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

/**
 * The one .xlsx/.csv loader for the row-capped bulk parsers (marks sheet, homework). The xlsx path
 * is bounded by `assertXlsxWithinLimits`; a csv has only a byte cap upstream, so its line count is
 * checked on the buffer BEFORE ExcelJS builds a `Row` object per line. Every message is a fixed
 * sentence (Rule 23). `Fail` lets each parser keep its own error class.
 */
export async function loadWorksheet(
  buffer: Buffer,
  filename: string,
  Fail: new (code: ImportFileErrorCode, message: string) => ImportFileError,
  maxCsvLines: number,
  maxRows: number,
): Promise<ExcelJS.Worksheet> {
  const ext = getExtension(filename);
  const workbook = new ExcelJS.Workbook();

  if (ext === '.xlsx') {
    try {
      await assertXlsxWithinLimits(buffer);
      await workbook.xlsx.load(buffer as never);
    } catch (e) {
      throw e instanceof XlsxTooLargeError
        ? new Fail(ImportFileErrorCode.TOO_LARGE, XLSX_TOO_LARGE_MESSAGE)
        : new Fail(
            ImportFileErrorCode.UNREADABLE,
            'Could not read file — is it a valid Excel file?',
          );
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Fail(
        ImportFileErrorCode.UNREADABLE,
        'Could not read file — is it a valid Excel file?',
      );
    }
    return worksheet;
  }

  if (ext === '.csv') {
    let lines = 0;
    for (let i = buffer.indexOf(10); i !== -1; i = buffer.indexOf(10, i + 1)) {
      if (++lines > maxCsvLines) {
        throw new Fail(
          ImportFileErrorCode.TOO_MANY_ROWS,
          `File has too many rows (max ${maxRows})`,
        );
      }
    }
    try {
      return await workbook.csv.read(Readable.from(buffer), { map: (datum: string) => datum });
    } catch {
      throw new Fail(
        ImportFileErrorCode.UNREADABLE,
        'Could not read file — is it a valid CSV file?',
      );
    }
  }

  throw new Fail(
    ImportFileErrorCode.UNSUPPORTED_TYPE,
    'Unsupported file type — upload .xlsx or .csv',
  );
}
