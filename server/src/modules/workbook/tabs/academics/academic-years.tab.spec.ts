import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { academicYearsTab, type AcademicYearRow } from './academic-years.tab';
import { academicsTabs } from './index';

const YEAR_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = { keyOf: () => '' };
const importCtx: ImportContext = {
  tenantId: TENANT_ID,
  ref: () => undefined,
  warn: () => undefined,
};

function makeYear(overrides: Partial<AcademicYear> = {}): AcademicYear {
  return Object.assign(new AcademicYear(), {
    id: YEAR_ID,
    name: '2026-2027',
    start_date: new Date(2026, 0, 1),
    end_date: new Date(2026, 11, 31),
    is_current: true,
    closed_at: null,
    closed_by_user_id: null,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<AcademicYear>);
}

function toCells(year: AcademicYear): Record<string, string> {
  const row = academicYearsTab.toRow(year, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of academicYearsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('academicYearsTab shape', () => {
  it('is registered through the academics barrel, first', () => {
    expect(academicsTabs[0]).toBe(academicYearsTab);
  });

  it('satisfies the registry contract', () => {
    // `partial: true` because `school` (a different lane's tab) is not
    // included here — only that dependency is missing, not a real problem.
    expect(() => assertRegistryValid([academicYearsTab], { partial: true })).not.toThrow();
  });

  it('depends only on school, deletes by absence', () => {
    expect(academicYearsTab.name).toBe('academic_years');
    expect(academicYearsTab.dependsOn).toEqual(['school']);
    expect(academicYearsTab.naturalKey).toEqual(['name']);
    expect(academicYearsTab.deleteByAbsence).toBe(true);
  });

  it('keys an academic year by its name', () => {
    expect(academicYearsTab.keyOf(makeYear())).toBe('2026-2027');
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const year = makeYear();

    const result = academicYearsTab.fromRow(toCells(year), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: YEAR_ID,
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: true,
        closed_at: null,
        closed_by_user_id: null,
      } satisfies AcademicYearRow,
    });
  });

  it('round-trips a non-current year', () => {
    const year = makeYear({ is_current: false });

    const result = academicYearsTab.fromRow(toCells(year), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: YEAR_ID,
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: false,
        closed_at: null,
        closed_by_user_id: null,
      } satisfies AcademicYearRow,
    });
  });

  it('rejects a name longer than the column allows', () => {
    const cells = { ...toCells(makeYear()), name: 'x'.repeat(51) };

    const result = academicYearsTab.fromRow(cells, 2, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('name');
  });

  it('rejects a missing required cell', () => {
    const cells = { ...toCells(makeYear()), name: '' };

    const result = academicYearsTab.fromRow(cells, 2, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('name');
  });

  it('rejects an is_current cell that is not a yes/no value', () => {
    const cells = { ...toCells(makeYear()), is_current: 'maybe' };

    const result = academicYearsTab.fromRow(cells, 2, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('is_current');
  });
});

describe('closed columns [69.1.03]', () => {
  const CLOSED = new Date('2025-12-31T10:00:00.000Z');
  const USER_ID = '22222222-2222-4222-8222-222222222222';

  it('exports closed_at and closed_by_user_id', () => {
    const keys = academicYearsTab.columns.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['closed_at', 'closed_by_user_id']));
    const row = academicYearsTab.toRow(
      makeYear({ is_current: false, closed_at: CLOSED, closed_by_user_id: USER_ID }),
      exportCtx,
    );
    expect(row.closed_at).toEqual(CLOSED);
    expect(row.closed_by_user_id).toBe(USER_ID);
  });

  it('rejects a closed year that is also current (same as the DB CHECK)', () => {
    const cells = { ...toCells(makeYear({ is_current: true })), closed_at: CLOSED.toISOString() };
    const result = academicYearsTab.fromRow(cells, 2, importCtx);
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('closed_at');
    // Rule 23: the submitted value is not echoed.
    expect(result.errors[0].message).not.toContain(CLOSED.toISOString());
  });

  it('imports a closed non-current year with its closer', () => {
    const cells = {
      ...toCells(makeYear({ is_current: false })),
      closed_at: CLOSED.toISOString(),
      closed_by_user_id: USER_ID,
    };
    const result = academicYearsTab.fromRow(cells, 2, importCtx);
    expect('row' in result).toBe(true);
    if (!('row' in result)) return;
    expect(result.row.closed_at).toBe(CLOSED.toISOString());
    expect(result.row.closed_by_user_id).toBe(USER_ID);
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const year = makeYear();
    const row: AcademicYearRow = {
      id: YEAR_ID,
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
      closed_at: null,
      closed_by_user_id: null,
    };

    expect(academicYearsTab.diffFields(row, year)).toEqual([]);
  });

  it('reports a changed name', () => {
    const year = makeYear();
    const row: AcademicYearRow = {
      id: YEAR_ID,
      name: '2027-2028',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
      closed_at: null,
      closed_by_user_id: null,
    };

    expect(academicYearsTab.diffFields(row, year)).toEqual(['name']);
  });
});
