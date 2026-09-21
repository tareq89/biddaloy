import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { GradingScale } from '../../../grading/entities/grading-scale.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { classesTab } from '../academics/classes.tab';
import { academicYearsTab } from '../academics/academic-years.tab';
import { gradingScalesTab, type GradingScaleRow } from './grading-scales.tab';
import { gradingTabs } from './index';

const SCALE_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6a';
const YEAR_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => {
    if (tab === 'academic_years' && id === YEAR_ID) return '2026-2027';
    if (tab === 'classes' && id === CLASS_ID) return 'Class 10|2026-2027';
    return '';
  },
};

function makeImportCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => {
      if (tab === 'academic_years' && key === '2026-2027') return YEAR_ID;
      if (tab === 'classes' && key === 'Class 10|2026-2027') return CLASS_ID;
      return undefined;
    },
    warn: () => undefined,
    ...overrides,
  };
}

function makeYear(): AcademicYear {
  return Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' });
}

function makeScale(overrides: Partial<GradingScale> = {}): GradingScale {
  return Object.assign(new GradingScale(), {
    id: SCALE_ID,
    name: 'BD NCTB',
    academic_year_id: YEAR_ID,
    academic_year: makeYear(),
    class_id: null,
    class: null,
    revision: 1,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<GradingScale>);
}

function toCells(scale: GradingScale): Record<string, string> {
  const row = gradingScalesTab.toRow(scale, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of gradingScalesTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('gradingScalesTab shape', () => {
  it('is registered through the grading barrel', () => {
    expect(gradingTabs).toContain(gradingScalesTab);
  });

  it('satisfies the registry contract together with academic_years and classes', () => {
    expect(() =>
      assertRegistryValid([academicYearsTab, classesTab, gradingScalesTab], { partial: true }),
    ).not.toThrow();
  });

  it('depends on academic_years and classes, deletes by absence', () => {
    expect(gradingScalesTab.name).toBe('grading_scales');
    expect(gradingScalesTab.dependsOn).toEqual(['academic_years', 'classes']);
    expect(gradingScalesTab.naturalKey).toEqual(['name', 'academic_year', 'class']);
    expect(gradingScalesTab.deleteByAbsence).toBe(true);
  });

  it('keys a year-default scale with an empty class segment', () => {
    const key = gradingScalesTab.keyOf(makeScale());
    expect(key).toBe('BD NCTB|2026-2027|');
  });

  it('keys a class-override scale with the class natural key', () => {
    const klass = Object.assign(new Class(), {
      id: CLASS_ID,
      name: 'Class 10',
      academic_year_id: YEAR_ID,
      academic_year: makeYear(),
      tenant_id: TENANT_ID,
    });
    const key = gradingScalesTab.keyOf(makeScale({ class_id: CLASS_ID, class: klass }));
    // [33.2.1] classesTab.keyOf now appends shift/version segments too —
    // empty here since this fixture's class sets neither.
    expect(key).toBe('BD NCTB|2026-2027|Class 10|2026-2027||');
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow, including revision', () => {
    const scale = makeScale({ revision: 3 });

    const result = gradingScalesTab.fromRow(toCells(scale), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SCALE_ID,
        name: 'BD NCTB',
        academic_year_id: YEAR_ID,
        academic_year_key: '2026-2027',
        class_id: null,
        class_key: null,
        revision: 3,
      } satisfies GradingScaleRow,
    });
  });

  it('reports a RowError naming the column and key on a class ref miss', () => {
    const cells = { ...toCells(makeScale()), class: 'Class 99|2026-2027' };

    const result = gradingScalesTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'class',
      row: 3,
      value: 'Class 99|2026-2027',
    });
  });
});

describe('diffFields', () => {
  it('reports a changed revision', () => {
    const scale = makeScale({ revision: 1 });
    const row: GradingScaleRow = {
      id: SCALE_ID,
      name: 'BD NCTB',
      academic_year_id: YEAR_ID,
      class_id: null,
      revision: 2,
      class_key: null,
      academic_year_key: 'unused',
    };

    expect(gradingScalesTab.diffFields(row, scale)).toEqual(['revision']);
  });
});

describe('upsert', () => {
  it('writes the restored revision, never falling back to the entity default', () => {
    const row: GradingScaleRow = {
      id: SCALE_ID,
      name: 'BD NCTB',
      academic_year_id: YEAR_ID,
      class_id: null,
      revision: 4,
      class_key: null,
      academic_year_key: '2026-2027',
    };

    let saved: GradingScale | undefined;
    const fakeManager = {
      save: async (_entity: unknown, value: GradingScale) => {
        saved = value;
        return value;
      },
    };

    return gradingScalesTab.upsert(row, null, TENANT_ID, fakeManager as never).then(() => {
      expect(saved?.revision).toBe(4);
    });
  });
});
