import { describe, expect, it } from 'vitest';
import { TeacherDesignation } from '@biddaloy/shared';
import { TeacherClassSection } from '../../../academics/entities/teacher-class-section.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Class } from '../../../academics/entities/class.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { User } from '../../../users/entities/user.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { schoolTab } from '../school/school.tab';
import { usersTab } from './users.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab, type TeacherAssignmentRow } from './teacher-assignments.tab';
import { academicYearsTab, classesTab, sectionsTab, subjectsTab } from '../academics';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const ASSIGNMENT_ID = '55555555-5555-4555-8555-555555555555';
const TEACHER_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '77777777-7777-4777-8777-777777777777';
const SECTION_ID = '88888888-8888-4888-8888-888888888888';
const CLASS_ID = '99999999-9999-4999-8999-999999999999';
const YEAR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeYear(): AcademicYear {
  return Object.assign(new AcademicYear(), {
    id: YEAR_ID,
    name: '2026',
    start_date: new Date('2026-01-01'),
    end_date: new Date('2026-12-31'),
    is_current: true,
    tenant_id: TENANT_ID,
  } satisfies Partial<AcademicYear>);
}

function makeClass(): Class {
  return Object.assign(new Class(), {
    id: CLASS_ID,
    name: 'Six',
    academic_year_id: YEAR_ID,
    academic_year: makeYear(),
    tenant_id: TENANT_ID,
  } satisfies Partial<Class>);
}

function makeSection(): ClassSection {
  return Object.assign(new ClassSection(), {
    id: SECTION_ID,
    class_id: CLASS_ID,
    class: makeClass(),
    section_name: 'A',
    capacity: null,
    tenant_id: TENANT_ID,
  } satisfies Partial<ClassSection>);
}

function makeSubject(): Subject {
  return Object.assign(new Subject(), {
    id: SUBJECT_ID,
    code: 'MATH',
    name_en: 'Mathematics',
    name_bn: null,
    is_active: true,
    tenant_id: TENANT_ID,
  } satisfies Partial<Subject>);
}

function makeUser(): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'teacher@dhaka-model.test',
    phone: '01712345678',
    full_name: 'Rahim Uddin',
  } satisfies Partial<User>);
}

function makeTeacher(): Teacher {
  return Object.assign(new Teacher(), {
    id: TEACHER_ID,
    user_id: USER_ID,
    user: makeUser(),
    employee_id: 'EMP001',
    designations: [TeacherDesignation.SUBJECT_TEACHER],
    subject_specialization: null,
    joining_date: null,
    tenant_id: TENANT_ID,
  } satisfies Partial<Teacher>);
}

function makeAssignment(overrides: Partial<TeacherClassSection> = {}): TeacherClassSection {
  return Object.assign(new TeacherClassSection(), {
    id: ASSIGNMENT_ID,
    teacher_id: TEACHER_ID,
    teacher: makeTeacher(),
    section_id: SECTION_ID,
    section: makeSection(),
    tenant_id: TENANT_ID,
    subject_id: SUBJECT_ID,
    subject: makeSubject(),
    ...overrides,
  } satisfies Partial<TeacherClassSection>);
}

const KEY_INDEX: Record<string, Record<string, string>> = {
  teachers: { EMP001: TEACHER_ID },
  classes: { 'Six|2026': CLASS_ID },
  academic_years: { '2026': YEAR_ID },
  sections: { 'Six|2026|2026|A': SECTION_ID },
  subjects: { MATH: SUBJECT_ID },
};

function exportCtx(): ExportContext {
  return {
    keyOf: (tab: string, id: string) => {
      if (tab === 'teachers') return id === TEACHER_ID ? 'EMP001' : '';
      if (tab === 'classes') return id === CLASS_ID ? 'Six|2026' : '';
      if (tab === 'academic_years') return id === YEAR_ID ? '2026' : '';
      if (tab === 'sections') return id === SECTION_ID ? 'Six|2026|2026|A' : '';
      if (tab === 'subjects') return id === SUBJECT_ID ? 'MATH' : '';
      return '';
    },
  };
}

function importCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab: string, key: string) => KEY_INDEX[tab]?.[key],
    warn: () => undefined,
  };
}

function toCells(entity: TeacherClassSection): Record<string, string> {
  const row = teacherAssignmentsTab.toRow(entity, exportCtx());
  const cells: Record<string, string> = {};
  for (const column of teacherAssignmentsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function fromRowOrThrow(cells: Record<string, string>): TeacherAssignmentRow {
  const result = teacherAssignmentsTab.fromRow(cells, 2, importCtx());
  if ('errors' in result) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.row;
}

describe('teacherAssignmentsTab shape', () => {
  it('is registered through the people barrel, after teachers', () => {
    expect(peopleTabs).toContain(teacherAssignmentsTab);
    expect(peopleTabs.indexOf(teachersTab)).toBeLessThan(peopleTabs.indexOf(teacherAssignmentsTab));
  });

  it('satisfies the registry contract', () => {
    expect(() =>
      assertRegistryValid(
        [
          schoolTab,
          academicYearsTab,
          classesTab,
          sectionsTab,
          subjectsTab,
          usersTab,
          teachersTab,
          teacherAssignmentsTab,
        ],
        { partial: true },
      ),
    ).not.toThrow();
  });

  it('declares its dependency and identity shape', () => {
    expect(teacherAssignmentsTab.name).toBe('teacher_assignments');
    expect(teacherAssignmentsTab.dependsOn).toEqual([
      'teachers',
      'classes',
      'academic_years',
      'sections',
      'subjects',
    ]);
    expect(teacherAssignmentsTab.naturalKey).toEqual([
      'teacher',
      'class',
      'academic_year',
      'section',
      'subject',
    ]);
    expect(teacherAssignmentsTab.deleteByAbsence).toBe(true);
  });
});

describe('round-trip', () => {
  it('fromRow(toRow(entity)) round-trips, and keyOf matches (five-fragment key)', () => {
    const assignment = makeAssignment();
    const cells = toCells(assignment);
    const row = fromRowOrThrow(cells);

    expect(row.teacher_id).toBe(TEACHER_ID);
    expect(row.section_id).toBe(SECTION_ID);
    expect(row.subject_id).toBe(SUBJECT_ID);
    expect(teacherAssignmentsTab.keyOf(row)).toBe(teacherAssignmentsTab.keyOf(assignment));
    // Nested pipes precedented (sections/class_subjects do the same):
    // teacherKey|classKey|academicYearKey|sectionKey|subjectKey.
    expect(teacherAssignmentsTab.keyOf(assignment)).toBe(
      'EMP001|Six|2026|2026|Six|2026|2026|A|MATH',
    );
  });

  it('emits no uuid in any of the five ref cells', () => {
    const cells = toCells(makeAssignment());
    for (const key of ['teacher', 'class', 'academic_year', 'section', 'subject']) {
      expect(cells[key]).not.toMatch(UUID_RE);
    }
  });

  it('an empty subject cell yields subject_id: null, no error, and round-trips', () => {
    const assignment = makeAssignment({ subject_id: null, subject: null });
    const cells = toCells(assignment);
    expect(cells.subject).toBe('');

    const row = fromRowOrThrow(cells);
    expect(row.subject_id).toBeNull();
    expect(teacherAssignmentsTab.keyOf(row)).toBe(teacherAssignmentsTab.keyOf(assignment));
  });

  it('an unresolvable teacher key yields a RowError naming that column', () => {
    const cells = toCells(makeAssignment());
    cells.teacher = 'GHOST999';
    const result = teacherAssignmentsTab.fromRow(cells, 3, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('teacher');
  });

  it('an unresolvable class key yields a RowError naming that column', () => {
    const cells = toCells(makeAssignment());
    cells.class = 'Nonexistent|1999';
    const result = teacherAssignmentsTab.fromRow(cells, 4, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('class');
  });

  it('an unresolvable academic_year key yields a RowError naming that column', () => {
    const cells = toCells(makeAssignment());
    cells.academic_year = '1999';
    const result = teacherAssignmentsTab.fromRow(cells, 5, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('academic_year');
  });

  it('an unresolvable section key yields a RowError naming that column', () => {
    const cells = toCells(makeAssignment());
    cells.section = 'Nowhere|1999|Z';
    const result = teacherAssignmentsTab.fromRow(cells, 6, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('section');
  });

  it('an unresolvable subject key yields a RowError naming that column', () => {
    const cells = toCells(makeAssignment());
    cells.subject = 'NOPE';
    const result = teacherAssignmentsTab.fromRow(cells, 7, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('subject');
  });
});

describe('diffFields', () => {
  it('reports nothing for a matched row: the fields are all in the natural key', () => {
    const assignment = makeAssignment();
    const row: TeacherAssignmentRow = {
      id: assignment.id,
      teacher_id: assignment.teacher_id,
      section_id: assignment.section_id,
      subject_id: assignment.subject_id,
      teacher_key: 'EMP001',
      class_key: 'Six|2026',
      academic_year_key: '2026',
      section_key: 'Six|2026|2026|A',
      subject_key: 'MATH',
    };
    expect(teacherAssignmentsTab.diffFields(row, assignment)).toEqual([]);
  });
});
