import { describe, expect, it } from 'vitest';
import { TeacherDesignation } from '@biddaloy/shared';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { User } from '../../../users/entities/user.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { schoolTab } from '../school/school.tab';
import { usersTab } from './users.tab';
import { teachersTab, type TeacherRow } from './teachers.tab';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const usersByEmail: Record<string, string> = { 'teacher@dhaka-model.test': USER_ID };

function exportCtx(): ExportContext {
  return {
    keyOf: (_tab: string, id: string) => (id === USER_ID ? 'teacher@dhaka-model.test' : ''),
  };
}

function importCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (_tab: string, key: string) => usersByEmail[key],
    warn: () => undefined,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'teacher@dhaka-model.test',
    phone: '01712345678',
    full_name: 'Rahim Uddin',
    ...overrides,
  } satisfies Partial<User>);
}

function makeTeacher(overrides: Partial<Teacher> = {}): Teacher {
  return Object.assign(new Teacher(), {
    id: TEACHER_ID,
    user_id: USER_ID,
    user: makeUser(),
    employee_id: 'EMP001',
    designations: [TeacherDesignation.CLASS_TEACHER, TeacherDesignation.SUBJECT_TEACHER],
    subject_specialization: 'Mathematics',
    joining_date: new Date('2026-01-15T00:00:00.000Z'),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Teacher>);
}

/** Real pipeline, both directions, mirroring `users.tab.spec.ts`. */
function toCells(teacher: Teacher): Record<string, string> {
  const row = teachersTab.toRow(teacher, exportCtx());
  const cells: Record<string, string> = {};
  for (const column of teachersTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function fromRowOrThrow(cells: Record<string, string>): TeacherRow {
  const result = teachersTab.fromRow(cells, 2, importCtx());
  if ('errors' in result) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.row;
}

describe('teachersTab shape', () => {
  it('is registered through the people barrel, after users', () => {
    expect(peopleTabs).toContain(teachersTab);
    expect(peopleTabs.indexOf(usersTab)).toBeLessThan(peopleTabs.indexOf(teachersTab));
  });

  it('satisfies the registry contract', () => {
    expect(() =>
      assertRegistryValid([schoolTab, usersTab, teachersTab], { partial: true }),
    ).not.toThrow();
  });

  it('declares its dependency and identity shape', () => {
    expect(teachersTab.name).toBe('teachers');
    expect(teachersTab.dependsOn).toEqual(['users']);
    expect(teachersTab.naturalKey).toEqual(['employee_id']);
    expect(teachersTab.deleteByAbsence).toBe(true);
    expect(teachersTab.columns[0]).toEqual({
      key: 'id',
      type: 'uuid',
      required: true,
      label: { en: 'ID', bn: 'আইডি' },
    });
  });

  it('excludes exactly user_id', () => {
    expect(teachersTab.excluded).toEqual(['user_id']);
    const exported = teachersTab.columns.map((c) => c.key);
    expect(exported).not.toContain('user_id');
  });
});

describe('round-trip', () => {
  it('fromRow(toRow(entity)) round-trips every field, and keyOf matches', () => {
    const teacher = makeTeacher();
    const cells = toCells(teacher);
    const row = fromRowOrThrow(cells);

    expect(row.employee_id).toBe(teacher.employee_id);
    expect(row.user_id).toBe(teacher.user_id);
    expect(row.subject_specialization).toBe(teacher.subject_specialization);
    expect(row.joining_date).toBe('2026-01-15');
    expect(new Set(row.designations)).toEqual(new Set(teacher.designations));
    expect(teachersTab.keyOf(row)).toBe(teachersTab.keyOf(teacher));
  });

  it('round-trips a multi-designation teacher through the `;` cell', () => {
    const teacher = makeTeacher({
      designations: [
        TeacherDesignation.HEAD_TEACHER,
        TeacherDesignation.PRINCIPAL,
        TeacherDesignation.COORDINATOR,
      ],
    });
    const cells = toCells(teacher);
    expect(cells.designations).toBe('HEAD_TEACHER;PRINCIPAL;COORDINATOR');

    const row = fromRowOrThrow(cells);
    expect(row.designations).toEqual([
      TeacherDesignation.HEAD_TEACHER,
      TeacherDesignation.PRINCIPAL,
      TeacherDesignation.COORDINATOR,
    ]);
  });

  it('an empty designations cell yields [], and toRow of [] yields an empty cell', () => {
    const teacher = makeTeacher({ designations: [] });
    const cells = toCells(teacher);
    expect(cells.designations).toBe('');

    const row = fromRowOrThrow(cells);
    expect(row.designations).toEqual([]);
  });

  it('an unknown designation token yields one RowError on column designations, other columns still parse', () => {
    const teacher = makeTeacher();
    const cells = toCells(teacher);
    cells.designations = 'CLASS_TEACHER;NOT_A_REAL_DESIGNATION';

    const result = teachersTab.fromRow(cells, 3, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('designations');
    expect(errors[0].message).toContain('NOT_A_REAL_DESIGNATION');
  });

  it('toRow writes `user` as the users natural key, not a uuid', () => {
    const teacher = makeTeacher();
    const cells = toCells(teacher);
    expect(cells.user).toBe('teacher@dhaka-model.test');
    expect(cells.user).not.toMatch(UUID_RE);
  });

  it('an unresolvable user key yields a RowError on column user', () => {
    const teacher = makeTeacher();
    const cells = toCells(teacher);
    cells.user = 'ghost@nowhere.test';

    const result = teachersTab.fromRow(cells, 4, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'user')).toBe(true);
  });

  it('empty required cells (employee_id, user) each yield their own RowError', () => {
    const teacher = makeTeacher();
    const cells = toCells(teacher);
    cells.employee_id = '';
    cells.user = '';

    const result = teachersTab.fromRow(cells, 5, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    const columns = errors.map((e) => e.column);
    expect(columns).toContain('employee_id');
    expect(columns).toContain('user');
  });

  it('employee_id over 50 chars yields a RowError', () => {
    const teacher = makeTeacher();
    const cells = toCells(teacher);
    cells.employee_id = 'E'.repeat(51);

    const result = teachersTab.fromRow(cells, 6, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'employee_id')).toBe(true);
  });

  it('subject_specialization over 100 chars yields a RowError', () => {
    const teacher = makeTeacher();
    const cells = toCells(teacher);
    cells.subject_specialization = 'S'.repeat(101);

    const result = teachersTab.fromRow(cells, 7, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'subject_specialization')).toBe(true);
  });

  it('empty joining_date cell yields null; a valid date round-trips as YYYY-MM-DD', () => {
    const teacher = makeTeacher({ joining_date: null });
    const cells = toCells(teacher);
    expect(cells.joining_date).toBe('');
    const row = fromRowOrThrow(cells);
    expect(row.joining_date).toBeNull();
  });
});

describe('diffFields', () => {
  it('reports nothing for an unchanged teacher whose designations are in a different order', () => {
    const teacher = makeTeacher({
      designations: [TeacherDesignation.CLASS_TEACHER, TeacherDesignation.SUBJECT_TEACHER],
    });
    const row: TeacherRow = {
      id: teacher.id,
      user_id: teacher.user_id,
      employee_id: teacher.employee_id,
      designations: [TeacherDesignation.SUBJECT_TEACHER, TeacherDesignation.CLASS_TEACHER],
      subject_specialization: teacher.subject_specialization,
      joining_date: '2026-01-15',
      user_key: 'teacher@dhaka-model.test',
    };

    expect(teachersTab.diffFields(row, teacher)).toEqual([]);
  });

  it('reports designations changed when the sets differ', () => {
    const teacher = makeTeacher({ designations: [TeacherDesignation.CLASS_TEACHER] });
    const row: TeacherRow = {
      id: teacher.id,
      user_id: teacher.user_id,
      employee_id: teacher.employee_id,
      designations: [TeacherDesignation.HEAD_TEACHER],
      subject_specialization: teacher.subject_specialization,
      joining_date: '2026-01-15',
      user_key: 'teacher@dhaka-model.test',
    };

    expect(teachersTab.diffFields(row, teacher)).toContain('designations');
  });
});
