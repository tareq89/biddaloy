import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { SchoolHoliday } from '../../../academics/entities/school-holiday.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { academicYearsTab } from './academic-years.tab';
import { holidaysTab, type HolidayRow } from './holidays.tab';
import { academicsTabs } from './index';

const HOLIDAY_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6e';
const YEAR_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => (tab === 'academic_years' && id === YEAR_ID ? '2026-2027' : ''),
};

function makeImportCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => (tab === 'academic_years' && key === '2026-2027' ? YEAR_ID : undefined),
    warn: () => undefined,
    ...overrides,
  };
}

function makeHoliday(overrides: Partial<SchoolHoliday> = {}): SchoolHoliday {
  return Object.assign(new SchoolHoliday(), {
    id: HOLIDAY_ID,
    academic_year_id: YEAR_ID,
    academic_year: Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' }),
    name: 'Winter break',
    start_date: '2026-12-20',
    end_date: '2026-12-31',
    counts_as_working_day: false,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<SchoolHoliday>);
}

function toCells(holiday: SchoolHoliday): Record<string, string> {
  const row = holidaysTab.toRow(holiday, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of holidaysTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('holidaysTab shape', () => {
  it('is registered through the academics barrel, after academic_years', () => {
    expect(academicsTabs).toContain(holidaysTab);
    expect(academicsTabs.indexOf(holidaysTab)).toBeGreaterThan(
      academicsTabs.indexOf(academicYearsTab),
    );
  });

  it('is the last tab in registration order', () => {
    expect(academicsTabs[academicsTabs.length - 1]).toBe(holidaysTab);
  });

  it('satisfies the registry contract together with academic_years', () => {
    expect(() =>
      assertRegistryValid([academicYearsTab, holidaysTab], { partial: true }),
    ).not.toThrow();
  });

  it('depends on academic_years, deletes by absence', () => {
    expect(holidaysTab.name).toBe('holidays');
    expect(holidaysTab.dependsOn).toEqual(['academic_years']);
    expect(holidaysTab.naturalKey).toEqual(['academic_year', 'name', 'start_date']);
    expect(holidaysTab.deleteByAbsence).toBe(true);
  });

  it('keys a holiday by year, name, and start date, never a uuid', () => {
    const key = holidaysTab.keyOf(makeHoliday());
    expect(key).toBe('2026-2027|Winter break|2026-12-20');
    expect(key).not.toContain(HOLIDAY_ID);
    expect(key).not.toContain(YEAR_ID);
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const holiday = makeHoliday();

    const result = holidaysTab.fromRow(toCells(holiday), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: HOLIDAY_ID,
        academic_year_id: YEAR_ID,
        name: 'Winter break',
        start_date: '2026-12-20',
        end_date: '2026-12-31',
        counts_as_working_day: false,
        academic_year_key: '2026-2027',
      } satisfies HolidayRow,
    });
  });

  it('reports a RowError naming the column and key on a ref miss', () => {
    const cells = { ...toCells(makeHoliday()), academic_year: 'nonexistent-year' };

    const result = holidaysTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'academic_year',
      row: 3,
      value: 'nonexistent-year',
    });
  });

  it('rejects a missing required name', () => {
    const cells = { ...toCells(makeHoliday()), name: '' };

    const result = holidaysTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('name');
  });

  it('rejects an end_date before start_date', () => {
    const cells = {
      ...toCells(makeHoliday()),
      start_date: '2026-12-31',
      end_date: '2026-12-20',
    };

    const result = holidaysTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({ column: 'end_date' });
  });

  it('accepts an end_date equal to start_date (a single-day holiday)', () => {
    const cells = {
      ...toCells(makeHoliday()),
      start_date: '2026-12-20',
      end_date: '2026-12-20',
    };

    const result = holidaysTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(false);
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const holiday = makeHoliday();
    const row: HolidayRow = {
      id: HOLIDAY_ID,
      academic_year_id: YEAR_ID,
      name: 'Winter break',
      start_date: '2026-12-20',
      end_date: '2026-12-31',
      counts_as_working_day: false,
      academic_year_key: '2026-2027',
    };

    expect(holidaysTab.diffFields(row, holiday)).toEqual([]);
  });

  it('reports a changed counts_as_working_day', () => {
    const holiday = makeHoliday();
    const row: HolidayRow = {
      id: HOLIDAY_ID,
      academic_year_id: YEAR_ID,
      name: 'Winter break',
      start_date: '2026-12-20',
      end_date: '2026-12-31',
      counts_as_working_day: true,
      academic_year_key: '2026-2027',
    };

    expect(holidaysTab.diffFields(row, holiday)).toEqual(['counts_as_working_day']);
  });
});
