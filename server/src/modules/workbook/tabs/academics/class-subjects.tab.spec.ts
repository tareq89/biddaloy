import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSubject } from '../../../academics/entities/class-subject.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { classSubjectsTab, type ClassSubjectRow } from './class-subjects.tab';
import { academicsTabs, classesTab, subjectsTab } from './index';

const CLASS_SUBJECT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6d';
const CLASS_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const YEAR_ID = '22222222-2222-4222-8222-222222222222';
const SUBJECT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6c';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => {
    if (tab === 'classes' && id === CLASS_ID) return 'Class 10|2026-2027';
    if (tab === 'academic_years' && id === YEAR_ID) return '2026-2027';
    if (tab === 'subjects' && id === SUBJECT_ID) return 'MATH';
    return '';
  },
};

function makeImportCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => {
      if (tab === 'classes' && key === 'Class 10|2026-2027') return CLASS_ID;
      if (tab === 'academic_years' && key === '2026-2027') return YEAR_ID;
      if (tab === 'subjects' && key === 'MATH') return SUBJECT_ID;
      return undefined;
    },
    warn: () => undefined,
    ...overrides,
  };
}

function makeYear(overrides: Partial<AcademicYear> = {}): AcademicYear {
  return Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027', ...overrides });
}

function makeClass(overrides: Partial<Class> = {}): Class {
  return Object.assign(new Class(), {
    id: CLASS_ID,
    name: 'Class 10',
    academic_year_id: YEAR_ID,
    academic_year: makeYear(),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Class>);
}

function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return Object.assign(new Subject(), {
    id: SUBJECT_ID,
    code: 'MATH',
    name_en: 'Mathematics',
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Subject>);
}

function makeClassSubject(overrides: Partial<ClassSubject> = {}): ClassSubject {
  return Object.assign(new ClassSubject(), {
    id: CLASS_SUBJECT_ID,
    class_id: CLASS_ID,
    class: makeClass(),
    academic_year_id: YEAR_ID,
    academic_year: makeYear(),
    subject_id: SUBJECT_ID,
    subject: makeSubject(),
    is_optional: false,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<ClassSubject>);
}

function toCells(classSubject: ClassSubject): Record<string, string> {
  const row = classSubjectsTab.toRow(classSubject, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of classSubjectsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('classSubjectsTab shape', () => {
  it('is registered through the academics barrel, after classes and subjects', () => {
    expect(academicsTabs).toContain(classSubjectsTab);
    expect(academicsTabs.indexOf(classSubjectsTab)).toBeGreaterThan(
      academicsTabs.indexOf(classesTab),
    );
    expect(academicsTabs.indexOf(classSubjectsTab)).toBeGreaterThan(
      academicsTabs.indexOf(subjectsTab),
    );
  });

  it('satisfies the registry contract together with classes and subjects', () => {
    expect(() =>
      assertRegistryValid([classesTab, subjectsTab, classSubjectsTab], { partial: true }),
    ).not.toThrow();
  });

  it('depends on classes and subjects, deletes by absence', () => {
    expect(classSubjectsTab.name).toBe('class_subjects');
    expect(classSubjectsTab.dependsOn).toEqual(['classes', 'subjects', 'academic_years']);
    expect(classSubjectsTab.naturalKey).toEqual(['class', 'academic_year', 'subject']);
    expect(classSubjectsTab.deleteByAbsence).toBe(true);
  });

  it('keys a class_subject by class, year, and subject code, never a uuid', () => {
    const key = classSubjectsTab.keyOf(makeClassSubject());
    expect(key).toBe('Class 10|2026-2027|2026-2027|MATH');
    // No id (uuid) segment appears in the key text.
    expect(key).not.toContain(CLASS_SUBJECT_ID);
    expect(key).not.toContain(CLASS_ID);
    expect(key).not.toContain(YEAR_ID);
    expect(key).not.toContain(SUBJECT_ID);
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const classSubject = makeClassSubject();

    const result = classSubjectsTab.fromRow(toCells(classSubject), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: CLASS_SUBJECT_ID,
        class_id: CLASS_ID,
        academic_year_id: YEAR_ID,
        subject_id: SUBJECT_ID,
        is_optional: false,
        class_key: 'Class 10|2026-2027',
        academic_year_key: '2026-2027',
        subject_key: 'MATH',
      } satisfies ClassSubjectRow,
    });
  });

  it('reports a RowError naming the column and key on a subject ref miss', () => {
    const cells = { ...toCells(makeClassSubject()), subject: 'nonexistent-code' };

    const result = classSubjectsTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'subject',
      row: 3,
      value: 'nonexistent-code',
    });
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const classSubject = makeClassSubject();
    const row: ClassSubjectRow = {
      id: CLASS_SUBJECT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
      subject_id: SUBJECT_ID,
      is_optional: false,
      class_key: 'unused',
      academic_year_key: 'unused',
      subject_key: 'unused',
    };

    expect(classSubjectsTab.diffFields(row, classSubject)).toEqual([]);
  });

  it('reports a changed is_optional', () => {
    const classSubject = makeClassSubject();
    const row: ClassSubjectRow = {
      id: CLASS_SUBJECT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
      subject_id: SUBJECT_ID,
      is_optional: true,
      class_key: 'unused',
      academic_year_key: 'unused',
      subject_key: 'unused',
    };

    expect(classSubjectsTab.diffFields(row, classSubject)).toEqual(['is_optional']);
  });
});
