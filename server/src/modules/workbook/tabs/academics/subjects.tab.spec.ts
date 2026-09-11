import { describe, expect, it } from 'vitest';
import { Subject } from '../../../academics/entities/subject.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { subjectsTab, type SubjectRow } from './subjects.tab';
import { academicsTabs, classesTab } from './index';

const SUBJECT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6c';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: () => '',
};

function makeImportCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: () => undefined,
    warn: () => undefined,
    ...overrides,
  };
}

function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return Object.assign(new Subject(), {
    id: SUBJECT_ID,
    code: 'MATH',
    name_en: 'Mathematics',
    name_bn: 'গণিত',
    is_active: true,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Subject>);
}

function toCells(subject: Subject): Record<string, string> {
  const row = subjectsTab.toRow(subject, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of subjectsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('subjectsTab shape', () => {
  it('is registered through the academics barrel, after classes (dependency order)', () => {
    expect(academicsTabs).toContain(subjectsTab);
    expect(academicsTabs.indexOf(subjectsTab)).toBeGreaterThan(academicsTabs.indexOf(classesTab));
  });

  it('satisfies the registry contract on its own', () => {
    expect(() => assertRegistryValid([subjectsTab], { partial: true })).not.toThrow();
  });

  it('depends on school, deletes by absence', () => {
    expect(subjectsTab.name).toBe('subjects');
    expect(subjectsTab.dependsOn).toEqual(['school']);
    expect(subjectsTab.naturalKey).toEqual(['code']);
    expect(subjectsTab.deleteByAbsence).toBe(true);
  });

  it('keys a subject by its code', () => {
    expect(subjectsTab.keyOf(makeSubject())).toBe('MATH');
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const subject = makeSubject();

    const result = subjectsTab.fromRow(toCells(subject), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SUBJECT_ID,
        code: 'MATH',
        name_en: 'Mathematics',
        name_bn: 'গণিত',
        is_active: true,
      } satisfies SubjectRow,
    });
  });

  it('round trips a null name_bn', () => {
    const subject = makeSubject({ name_bn: null });

    const result = subjectsTab.fromRow(toCells(subject), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SUBJECT_ID,
        code: 'MATH',
        name_en: 'Mathematics',
        name_bn: null,
        is_active: true,
      } satisfies SubjectRow,
    });
  });

  it('rejects a missing required code', () => {
    const cells = { ...toCells(makeSubject()), code: '' };

    const result = subjectsTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('code');
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const subject = makeSubject();
    const row: SubjectRow = {
      id: SUBJECT_ID,
      code: 'MATH',
      name_en: 'Mathematics',
      name_bn: 'গণিত',
      is_active: true,
    };

    expect(subjectsTab.diffFields(row, subject)).toEqual([]);
  });

  it('reports a changed is_active', () => {
    const subject = makeSubject();
    const row: SubjectRow = {
      id: SUBJECT_ID,
      code: 'MATH',
      name_en: 'Mathematics',
      name_bn: 'গণিত',
      is_active: false,
    };

    expect(subjectsTab.diffFields(row, subject)).toEqual(['is_active']);
  });
});
