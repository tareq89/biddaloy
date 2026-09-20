import { describe, it, expect } from 'vitest';
import { toCsvContent } from '@biddaloy/shared';
import {
  buildCalendarImportCsvTemplate,
  buildCalendarImportXlsxTemplate,
  CalendarImportFileError,
  parseCalendarImportFile,
} from './calendar-import-file.util';
import { CALENDAR_IMPORT_COLUMNS } from './calendar-import-rows.util';

describe('calendar-import-file.util (17.3.1)', () => {
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
