import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { academicYearsTab } from './academic-years.tab';
import { classesTab, type ClassRow } from './classes.tab';
import { academicsTabs } from './index';

const CLASS_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
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

function makeClass(overrides: Partial<Class> = {}): Class {
  return Object.assign(new Class(), {
    id: CLASS_ID,
    name: 'Class 10',
    numeric_grade: 10,
    shift: null,
    version: null,
    academic_year_id: YEAR_ID,
    academic_year: Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' }),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Class>);
}

function toCells(klass: Class): Record<string, string> {
  const row = classesTab.toRow(klass, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of classesTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('classesTab shape', () => {
  it('is registered through the academics barrel, after academic_years', () => {
    expect(academicsTabs).toContain(classesTab);
    expect(academicsTabs.indexOf(classesTab)).toBeGreaterThan(
      academicsTabs.indexOf(academicYearsTab),
    );
  });

  it('satisfies the registry contract together with academic_years', () => {
    expect(() =>
      assertRegistryValid([academicYearsTab, classesTab], { partial: true }),
    ).not.toThrow();
  });

  it('depends on academic_years, deletes by absence', () => {
    expect(classesTab.name).toBe('classes');
    expect(classesTab.dependsOn).toEqual(['academic_years']);
    expect(classesTab.naturalKey).toEqual(['name', 'academic_year', 'shift', 'version']);
    expect(classesTab.deleteByAbsence).toBe(true);
  });

  it('keys a class by name, academic year, shift and version, never a uuid', () => {
    expect(classesTab.keyOf(makeClass())).toBe('Class 10|2026-2027||');
  });

  // [33.2.1] The DB's own unique index is `(name, academic_year_id,
  // tenant_id, shift, version)` — two classes can legitimately share a
  // name and year. If `keyOf` didn't include shift/version, both classes
  // would collapse onto the same workbook key, and `deleteByAbsence: true`
  // would delete whichever one loses that collision on the next restore.
  it('keys two same-name-and-year classes distinctly when only shift differs', () => {
    const morning = makeClass({ shift: 'Morning' });
    const day = makeClass({ shift: 'Day' });

    expect(classesTab.keyOf(morning)).not.toBe(classesTab.keyOf(day));
  });

  it('keys two same-name-and-year classes distinctly when only version differs', () => {
    const bangla = makeClass({ version: 'Bangla' });
    const english = makeClass({ version: 'English' });

    expect(classesTab.keyOf(bangla)).not.toBe(classesTab.keyOf(english));
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const klass = makeClass();

    const result = classesTab.fromRow(toCells(klass), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: CLASS_ID,
        name: 'Class 10',
        academic_year_id: YEAR_ID,
        academic_year_key: '2026-2027',
        shift: null,
        version: null,
      } satisfies ClassRow,
    });
  });

  it('round-trips a class with shift and version set', () => {
    const klass = makeClass({ shift: 'Morning', version: 'Bangla' });

    const result = classesTab.fromRow(toCells(klass), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: CLASS_ID,
        name: 'Class 10',
        academic_year_id: YEAR_ID,
        academic_year_key: '2026-2027',
        shift: 'Morning',
        version: 'Bangla',
      } satisfies ClassRow,
    });
  });

  it('reports a RowError naming the column and key on a ref miss', () => {
    const cells = { ...toCells(makeClass()), academic_year: 'nonexistent-year' };

    const result = classesTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'academic_year',
      row: 3,
      value: 'nonexistent-year',
    });
  });

  it('rejects a missing required name', () => {
    const cells = { ...toCells(makeClass()), name: '' };

    const result = classesTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('name');
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const klass = makeClass();
    const row: ClassRow = {
      id: CLASS_ID,
      name: 'Class 10',
      academic_year_id: YEAR_ID,
      academic_year_key: '2026-2027',
      shift: null,
      version: null,
    };

    expect(classesTab.diffFields(row, klass)).toEqual([]);
  });

  it('reports a changed academic year', () => {
    const klass = makeClass();
    const row: ClassRow = {
      id: CLASS_ID,
      name: 'Class 10',
      academic_year_id: '33333333-3333-4333-8333-333333333333',
      academic_year_key: '2027-2028',
      shift: null,
      version: null,
    };

    expect(classesTab.diffFields(row, klass)).toEqual(['academic_year']);
  });

  it('reports a changed shift', () => {
    const klass = makeClass({ shift: 'Morning' });
    const row: ClassRow = {
      id: CLASS_ID,
      name: 'Class 10',
      academic_year_id: YEAR_ID,
      academic_year_key: '2026-2027',
      shift: 'Day',
      version: null,
    };

    expect(classesTab.diffFields(row, klass)).toEqual(['shift']);
  });
});
