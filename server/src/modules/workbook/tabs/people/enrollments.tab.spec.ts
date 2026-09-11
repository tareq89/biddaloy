import { describe, expect, it } from 'vitest';
import { EnrollmentStatus } from '@biddaloy/shared';
import { Enrollment } from '../../../students/entities/enrollment.entity';
import { Student } from '../../../students/entities/student.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { schoolTab } from '../school/school.tab';
import { usersTab } from './users.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab } from './teacher-assignments.tab';
import { guardiansTab } from './guardians.tab';
import { studentsTab } from './students.tab';
import { enrollmentsTab, type EnrollmentRow } from './enrollments.tab';
import { academicYearsTab, classesTab, sectionsTab, subjectsTab } from '../academics';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const ENROLLMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STUDENT_ID = '66666666-6666-4666-8666-666666666666';
const CLASS_ID = '99999999-9999-4999-8999-999999999999';
const SECTION_ID = '88888888-8888-4888-8888-888888888888';
const YEAR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

function makeStudent(): Student {
  return Object.assign(new Student(), {
    id: STUDENT_ID,
    registration_number: 'S-001',
    tenant_id: TENANT_ID,
  } satisfies Partial<Student>);
}

function makeEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return Object.assign(new Enrollment(), {
    id: ENROLLMENT_ID,
    student_id: STUDENT_ID,
    student: makeStudent(),
    class_id: CLASS_ID,
    section_id: SECTION_ID,
    academic_year_id: YEAR_ID,
    academic_year: makeYear(),
    enrollment_status: EnrollmentStatus.ACTIVE,
    enrolled_at: new Date('2026-01-15T00:00:00.000Z'),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Enrollment>);
}

const KEY_INDEX: Record<string, Record<string, string>> = {
  students: { 'S-001': STUDENT_ID },
  classes: { 'Six|2026': CLASS_ID },
  academic_years: { '2026': YEAR_ID },
  sections: { 'Six|2026|2026|A': SECTION_ID },
};

function exportCtx(): ExportContext {
  return {
    keyOf: (tab: string, id: string) => {
      if (tab === 'students') return id === STUDENT_ID ? 'S-001' : '';
      if (tab === 'classes') return id === CLASS_ID ? 'Six|2026' : '';
      if (tab === 'academic_years') return id === YEAR_ID ? '2026' : '';
      if (tab === 'sections') return id === SECTION_ID ? 'Six|2026|2026|A' : '';
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

function toCells(entity: Enrollment): Record<string, string> {
  const row = enrollmentsTab.toRow(entity, exportCtx());
  const cells: Record<string, string> = {};
  for (const column of enrollmentsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function fromRowOrThrow(cells: Record<string, string>): EnrollmentRow {
  const result = enrollmentsTab.fromRow(cells, 2, importCtx());
  if ('errors' in result) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.row;
}

describe('enrollmentsTab shape', () => {
  it('is registered through the people barrel, last, after students', () => {
    expect(peopleTabs).toContain(enrollmentsTab);
    expect(peopleTabs.indexOf(studentsTab)).toBeLessThan(peopleTabs.indexOf(enrollmentsTab));
    expect(peopleTabs[peopleTabs.length - 1]).toBe(enrollmentsTab);
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
          guardiansTab,
          studentsTab,
          enrollmentsTab,
        ],
        { partial: true },
      ),
    ).not.toThrow();
  });

  it('declares its dependency and identity shape', () => {
    expect(enrollmentsTab.name).toBe('enrollments');
    expect(enrollmentsTab.dependsOn).toEqual(['students', 'classes', 'academic_years', 'sections']);
    expect(enrollmentsTab.naturalKey).toEqual(['student', 'academic_year']);
    expect(enrollmentsTab.deleteByAbsence).toBe(true);
  });
});

describe('round-trip', () => {
  it('fromRow(toRow(entity)) round-trips with a section present', () => {
    const enrollment = makeEnrollment();
    const cells = toCells(enrollment);
    const row = fromRowOrThrow(cells);

    expect(row.student_id).toBe(STUDENT_ID);
    expect(row.class_id).toBe(CLASS_ID);
    expect(row.academic_year_id).toBe(YEAR_ID);
    expect(row.section_id).toBe(SECTION_ID);
    expect(row.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    expect(enrollmentsTab.keyOf(row)).toBe(enrollmentsTab.keyOf(enrollment));
    expect(enrollmentsTab.keyOf(enrollment)).toBe('S-001|2026');
  });

  it('fromRow(toRow(entity)) round-trips with no section', () => {
    const enrollment = makeEnrollment({ section_id: null, section: null });
    const cells = toCells(enrollment);
    expect(cells.section).toBe('');

    const row = fromRowOrThrow(cells);
    expect(row.section_id).toBeNull();
    expect(enrollmentsTab.keyOf(row)).toBe(enrollmentsTab.keyOf(enrollment));
  });

  it('emits no uuid in any of the four ref cells', () => {
    const cells = toCells(makeEnrollment());
    for (const key of ['student', 'class', 'academic_year', 'section']) {
      expect(cells[key]).not.toMatch(UUID_RE);
    }
  });

  it('an unresolvable student key yields a RowError naming that column', () => {
    const cells = toCells(makeEnrollment());
    cells.student = 'GHOST999';
    const result = enrollmentsTab.fromRow(cells, 3, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('student');
  });

  it('an unresolvable class key yields a RowError naming that column', () => {
    const cells = toCells(makeEnrollment());
    cells.class = 'Nonexistent|1999';
    const result = enrollmentsTab.fromRow(cells, 4, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('class');
  });

  it('an unresolvable academic_year key yields a RowError naming that column', () => {
    const cells = toCells(makeEnrollment());
    cells.academic_year = '1999';
    const result = enrollmentsTab.fromRow(cells, 5, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('academic_year');
  });

  it('an unresolvable section key yields a RowError naming that column', () => {
    const cells = toCells(makeEnrollment());
    cells.section = 'Nowhere|1999|Z';
    const result = enrollmentsTab.fromRow(cells, 6, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('section');
  });

  it('empty required cells (student/class/academic_year) are errors', () => {
    const cells = toCells(makeEnrollment());
    cells.student = '';
    cells.class = '';
    cells.academic_year = '';
    const result = enrollmentsTab.fromRow(cells, 7, importCtx());
    expect('errors' in result).toBe(true);
    const columns = (result as { errors: RowError[] }).errors.map((e) => e.column);
    expect(columns).toContain('student');
  });

  it('an empty section cell is not an error', () => {
    const cells = toCells(makeEnrollment());
    cells.section = '';
    const row = fromRowOrThrow(cells);
    expect(row.section_id).toBeNull();
    expect(row.section_key).toBeNull();
  });

  it('an empty enrollment_status cell defaults to ACTIVE', () => {
    const cells = toCells(makeEnrollment());
    cells.enrollment_status = '';
    const row = fromRowOrThrow(cells);
    expect(row.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
  });

  it('an empty enrolled_at cell defaults to a valid ISO timestamp', () => {
    const cells = toCells(makeEnrollment());
    cells.enrolled_at = '';
    const row = fromRowOrThrow(cells);
    expect(() => new Date(row.enrolled_at).toISOString()).not.toThrow();
    expect(Number.isNaN(new Date(row.enrolled_at).getTime())).toBe(false);
  });

  it('a bad enum value produces a RowError', () => {
    const cells = toCells(makeEnrollment());
    cells.enrollment_status = 'NOT_A_STATUS';
    const result = enrollmentsTab.fromRow(cells, 8, importCtx());
    expect('errors' in result).toBe(true);
  });

  it('a bad datetime value produces a RowError', () => {
    const cells = toCells(makeEnrollment());
    cells.enrolled_at = 'not-a-date';
    const result = enrollmentsTab.fromRow(cells, 9, importCtx());
    expect('errors' in result).toBe(true);
  });
});

describe('diffFields', () => {
  it('reports nothing for an unchanged pair, including enrolled_at normalization', () => {
    const enrollment = makeEnrollment();
    const row: EnrollmentRow = {
      id: enrollment.id,
      student_id: enrollment.student_id,
      class_id: enrollment.class_id,
      academic_year_id: enrollment.academic_year_id,
      section_id: enrollment.section_id,
      enrollment_status: enrollment.enrollment_status,
      enrolled_at: enrollment.enrolled_at.toISOString(),
      student_key: 'S-001',
      class_key: 'Six|2026',
      academic_year_key: '2026',
      section_key: 'Six|2026|2026|A',
    };
    expect(enrollmentsTab.diffFields(row, enrollment)).toEqual([]);
  });

  it('reports exactly ["enrollment_status"] for a status-only change', () => {
    const enrollment = makeEnrollment();
    const row: EnrollmentRow = {
      id: enrollment.id,
      student_id: enrollment.student_id,
      class_id: enrollment.class_id,
      academic_year_id: enrollment.academic_year_id,
      section_id: enrollment.section_id,
      enrollment_status: EnrollmentStatus.GRADUATED,
      enrolled_at: enrollment.enrolled_at.toISOString(),
      student_key: 'S-001',
      class_key: 'Six|2026',
      academic_year_key: '2026',
      section_key: 'Six|2026|2026|A',
    };
    expect(enrollmentsTab.diffFields(row, enrollment)).toEqual(['enrollment_status']);
  });
});
