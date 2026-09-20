import { describe, it, expect } from 'vitest';
import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import { validateCalendarImportRow, RawCalendarImportRow } from './calendar-import-rows.util';

function row(overrides: Partial<RawCalendarImportRow> = {}): RawCalendarImportRow {
  return {
    type: 'HOLIDAY',
    name: 'Independence Day',
    start_date: '2030-03-26',
    end_date: '2030-03-26',
    start_time: '',
    end_time: '',
    counts_as_working_day: 'FALSE',
    audience: 'ALL',
    classes: '',
    description: '',
    ...overrides,
  };
}

describe('validateCalendarImportRow (17.3.1)', () => {
  it('accepts a fully valid row and returns no errors', () => {
    const { row: parsed, errors } = validateCalendarImportRow(row(), 2);
    expect(errors).toEqual([]);
    expect(parsed).toEqual({
      type: CalendarEventType.HOLIDAY,
      name: 'Independence Day',
      start_date: '2030-03-26',
      end_date: '2030-03-26',
      start_time: null,
      end_time: null,
      counts_as_working_day: false,
      audience: CalendarAudience.ALL,
      class_names: [],
      description: null,
    });
  });

  it('parses comma-separated class names, trimmed and deduped', () => {
    const { row: parsed } = validateCalendarImportRow(
      row({ classes: 'Class 8, Class 9 ,Class 8' }),
      2,
    );
    expect(parsed?.class_names).toEqual(['Class 8', 'Class 9']);
  });

  it('rejects an unknown "type"', () => {
    const { row: parsed, errors } = validateCalendarImportRow(row({ type: 'BOGUS' }), 2);
    expect(parsed).toBeNull();
    expect(errors).toEqual([
      expect.objectContaining({ row: 2, column: 'type', severity: 'error' }),
    ]);
  });

  it('rejects an empty "name"', () => {
    const { row: parsed, errors } = validateCalendarImportRow(row({ name: '   ' }), 3);
    expect(parsed).toBeNull();
    expect(errors).toEqual([expect.objectContaining({ row: 3, column: 'name' })]);
  });

  it('rejects a malformed "start_date"/"end_date"', () => {
    const { errors } = validateCalendarImportRow(row({ start_date: '26-03-2030' }), 2);
    expect(errors).toEqual([expect.objectContaining({ column: 'start_date' })]);
  });

  it('rejects end_date before start_date', () => {
    const { errors } = validateCalendarImportRow(
      row({ start_date: '2030-03-26', end_date: '2030-03-25' }),
      2,
    );
    expect(errors).toEqual([expect.objectContaining({ column: 'end_date' })]);
  });

  it('rejects a malformed "start_time"/"end_time"', () => {
    const { errors } = validateCalendarImportRow(row({ start_time: '9am' }), 2);
    expect(errors).toEqual([expect.objectContaining({ column: 'start_time' })]);
  });

  it('rejects an out-of-range seconds component in "HH:mm:ss"', () => {
    // The shape regex alone matches "12:34:99" — isRealTime() must also
    // reject a seconds value outside 0-59, not just hours/minutes.
    const { errors } = validateCalendarImportRow(row({ start_time: '12:34:99' }), 2);
    expect(errors).toEqual([expect.objectContaining({ column: 'start_time' })]);
  });

  it('accepts a valid "HH:mm:ss" with seconds present', () => {
    const { row: parsed, errors } = validateCalendarImportRow(row({ start_time: '12:34:56' }), 2);
    expect(errors).toEqual([]);
    expect(parsed?.start_time).toBe('12:34:56');
  });

  it('accepts YES/NO/1/0 as counts_as_working_day synonyms', () => {
    expect(
      validateCalendarImportRow(row({ counts_as_working_day: 'YES' }), 2).row
        ?.counts_as_working_day,
    ).toBe(true);
    expect(
      validateCalendarImportRow(row({ counts_as_working_day: '1' }), 2).row?.counts_as_working_day,
    ).toBe(true);
    expect(
      validateCalendarImportRow(row({ counts_as_working_day: 'NO' }), 2).row?.counts_as_working_day,
    ).toBe(false);
  });

  it('rejects an unparseable counts_as_working_day', () => {
    const { errors } = validateCalendarImportRow(row({ counts_as_working_day: 'maybe' }), 2);
    expect(errors).toEqual([expect.objectContaining({ column: 'counts_as_working_day' })]);
  });

  it('defaults "audience" to ALL when blank, rejects an unknown value', () => {
    expect(validateCalendarImportRow(row({ audience: '' }), 2).row?.audience).toBe(
      CalendarAudience.ALL,
    );
    const { errors } = validateCalendarImportRow(row({ audience: 'BOGUS' }), 2);
    expect(errors).toEqual([expect.objectContaining({ column: 'audience' })]);
  });

  it('collects every error on a row with multiple problems', () => {
    const { row: parsed, errors } = validateCalendarImportRow(
      row({ type: 'BOGUS', name: '', start_date: 'bad' }),
      5,
    );
    expect(parsed).toBeNull();
    expect(errors.length).toBe(3);
  });

  it('treats blank description as null', () => {
    expect(validateCalendarImportRow(row({ description: '  ' }), 2).row?.description).toBeNull();
    expect(validateCalendarImportRow(row({ description: 'Notes' }), 2).row?.description).toBe(
      'Notes',
    );
  });
});
