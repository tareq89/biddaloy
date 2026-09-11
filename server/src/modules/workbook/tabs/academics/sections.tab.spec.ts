import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { academicYearsTab } from './academic-years.tab';
import { classesTab } from './classes.tab';
import { sectionsTab, type ClassSectionRow } from './sections.tab';
import { academicsTabs } from './index';

const SECTION_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const CLASS_ID = '44444444-4444-4444-8444-444444444444';
const YEAR_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => {
    if (tab === 'classes' && id === CLASS_ID) return `Class 10|${YEAR_ID}`;
    if (tab === 'academic_years' && id === YEAR_ID) return '2026-2027';
    return '';
  },
};

function makeImportCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => {
      if (tab === 'classes' && key === `Class 10|${YEAR_ID}`) return CLASS_ID;
      if (tab === 'academic_years' && key === '2026-2027') return YEAR_ID;
      return undefined;
    },
    warn: () => undefined,
    ...overrides,
  };
}

function makeClass(overrides: Partial<Class> = {}): Class {
  return Object.assign(new Class(), {
    id: CLASS_ID,
    name: 'Class 10',
    academic_year_id: YEAR_ID,
    academic_year: Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' }),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Class>);
}

function makeSection(overrides: Partial<ClassSection> = {}): ClassSection {
  return Object.assign(new ClassSection(), {
    id: SECTION_ID,
    class_id: CLASS_ID,
    class: makeClass(),
    section_name: 'A',
    capacity: 40,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<ClassSection>);
}

function toCells(section: ClassSection): Record<string, string> {
  const row = sectionsTab.toRow(section, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of sectionsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('sectionsTab shape', () => {
  it('is registered through the academics barrel, last', () => {
    expect(academicsTabs[academicsTabs.length - 1]).toBe(sectionsTab);
  });

  it('satisfies the registry contract together with its dependencies', () => {
    expect(() =>
      assertRegistryValid([academicYearsTab, classesTab, sectionsTab], { partial: true }),
    ).not.toThrow();
  });

  it('depends on classes and academic_years, deletes by absence', () => {
    expect(sectionsTab.name).toBe('sections');
    expect(sectionsTab.dependsOn).toEqual(['classes', 'academic_years']);
    expect(sectionsTab.naturalKey).toEqual(['class', 'academic_year', 'section_name']);
    expect(sectionsTab.deleteByAbsence).toBe(true);
  });

  it('keys a section by class, academic year, and section name, never a uuid', () => {
    // The `class` segment is itself the classes tab's own key
    // (`name|academic_year`), so the joined string has an embedded pipe —
    // still unique and stable, just not exactly three `|`-separated parts.
    expect(sectionsTab.keyOf(makeSection())).toBe('Class 10|2026-2027|2026-2027|A');
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const section = makeSection();

    const result = sectionsTab.fromRow(toCells(section), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SECTION_ID,
        class_id: CLASS_ID,
        academic_year_id: YEAR_ID,
        section_name: 'A',
        capacity: 40,
        class_key: `Class 10|${YEAR_ID}`,
        academic_year_key: '2026-2027',
      } satisfies ClassSectionRow,
    });
  });

  it('round-trips a section with no capacity set', () => {
    const section = makeSection({ capacity: null });

    const result = sectionsTab.fromRow(toCells(section), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SECTION_ID,
        class_id: CLASS_ID,
        academic_year_id: YEAR_ID,
        section_name: 'A',
        capacity: null,
        class_key: `Class 10|${YEAR_ID}`,
        academic_year_key: '2026-2027',
      } satisfies ClassSectionRow,
    });
  });

  it('reports a RowError naming the column and key on a class ref miss', () => {
    const cells = { ...toCells(makeSection()), class: 'Class 99|2026-2027' };

    const result = sectionsTab.fromRow(cells, 4, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'class',
      row: 4,
      value: 'Class 99|2026-2027',
    });
  });

  it('reports a RowError naming the column and key on an academic year ref miss', () => {
    const cells = { ...toCells(makeSection()), academic_year: '2099-2100' };

    const result = sectionsTab.fromRow(cells, 5, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'academic_year',
      row: 5,
      value: '2099-2100',
    });
  });

  it('rejects a section_name longer than the column allows', () => {
    const cells = { ...toCells(makeSection()), section_name: 'x'.repeat(21) };

    const result = sectionsTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('section_name');
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const section = makeSection();
    const row: ClassSectionRow = {
      id: SECTION_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
      section_name: 'A',
      capacity: 40,
      class_key: `Class 10|${YEAR_ID}`,
      academic_year_key: '2026-2027',
    };

    expect(sectionsTab.diffFields(row, section)).toEqual([]);
  });

  it('reports a changed capacity', () => {
    const section = makeSection();
    const row: ClassSectionRow = {
      id: SECTION_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
      section_name: 'A',
      capacity: 45,
      class_key: `Class 10|${YEAR_ID}`,
      academic_year_key: '2026-2027',
    };

    expect(sectionsTab.diffFields(row, section)).toEqual(['capacity']);
  });
});
