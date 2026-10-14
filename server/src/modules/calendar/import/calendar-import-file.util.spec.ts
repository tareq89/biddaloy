import { describe, it, expect, vi } from 'vitest';
import { toCsvContent } from '@biddaloy/shared';
import {
  buildCalendarImportCsvTemplate,
  buildCalendarImportXlsxTemplate,
  CalendarImportFileError,
  parseCalendarImportFile,
} from './calendar-import-file.util';
import { CALENDAR_IMPORT_COLUMNS } from './calendar-import-rows.util';
import { XLSX_TOO_LARGE_MESSAGE } from '../../../common/utils/xlsx-guard.util';

const guardState = vi.hoisted(() => ({ bomb: false }));
vi.mock('../../../common/utils/xlsx-guard.util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../common/utils/xlsx-guard.util')>();
  return {
    ...actual,
    assertXlsxWithinLimits: async (...a: Parameters<typeof actual.assertXlsxWithinLimits>) => {
      if (guardState.bomb) throw new actual.XlsxTooLargeError('bomb');
      return actual.assertXlsxWithinLimits(...a);
    },
  };
});

describe('calendar-import-file.util (17.3.1)', () => {
  it('refuses an xlsx the zip-bomb guard rejects with the "too large" error', async () => {
    const buf = await buildCalendarImportXlsxTemplate();
    guardState.bomb = true;
    try {
      await expect(parseCalendarImportFile(buf, 'a.xlsx')).rejects.toThrow(XLSX_TOO_LARGE_MESSAGE);
    } finally {
      guardState.bomb = false;
    }
  });

  it('round-trips the .csv template through the parser', async () => {
    const csv = buildCalendarImportCsvTemplate();
    const rows = await parseCalendarImportFile(Buffer.from(csv, 'utf8'), 'template.csv');
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe('Independence Day');
    expect(rows[1].classes).toBe('Class 8, Class 9');
  });

  it('round-trips the .xlsx template through the parser', async () => {
    const buffer = await buildCalendarImportXlsxTemplate();
    const rows = await parseCalendarImportFile(buffer, 'template.xlsx');
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe('Independence Day');
    expect(rows[1].start_time).toBe('09:00');
  });

  it('matches columns by header name, not position', async () => {
    const reordered = [
      [...CALENDAR_IMPORT_COLUMNS].reverse(),
      [...CALENDAR_IMPORT_COLUMNS].reverse().map((c) => (c === 'name' ? 'Reordered Event' : '')),
    ];
    const csv = toCsvContent(reordered);
    const rows = await parseCalendarImportFile(Buffer.from(csv, 'utf8'), 'reordered.csv');
    expect(rows[0].name).toBe('Reordered Event');
  });

  it('rejects a file with a missing required column', async () => {
    const csv = toCsvContent([
      ['type', 'name'],
      ['EVENT', 'Missing Columns'],
    ]);
    await expect(
      parseCalendarImportFile(Buffer.from(csv, 'utf8'), 'bad.csv'),
    ).rejects.toBeInstanceOf(CalendarImportFileError);
  });

  it('rejects an unsupported file extension', async () => {
    await expect(parseCalendarImportFile(Buffer.from(''), 'file.txt')).rejects.toBeInstanceOf(
      CalendarImportFileError,
    );
  });

  it('rejects an empty file', async () => {
    await expect(parseCalendarImportFile(Buffer.from(''), 'empty.csv')).rejects.toBeInstanceOf(
      CalendarImportFileError,
    );
  });
});
