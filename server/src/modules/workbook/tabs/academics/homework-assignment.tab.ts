import type { EntityManager } from 'typeorm';
import { HomeworkAssignmentStatus } from '@biddaloy/shared';
import { HomeworkAssignment } from '../../../homework/entities/homework-assignment.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { homeworkTab } from './homework.tab';
import { sectionsTab } from './sections.tab';
import { studentsTab } from '../people/students.tab';

/**
 * The `homework_assignments` tab (Epic 22.0, [22.3.6]). Who a `Homework` is
 * assigned to (D24: a section XOR a student — see the entity's own `CHECK`
 * constraint), so exactly one of `section`/`student` is ever non-empty on a
 * row.
 */
export interface HomeworkAssignmentRow {
  id: string;
  homework_id: string;
  section_id: string | null;
  student_id: string | null;
  assigned_date: string;
  due_date: string;
  status: HomeworkAssignmentStatus;
  homework_key: string;
  section_key: string;
  student_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'homework',
    type: 'ref',
    ref: 'homework',
    required: true,
    label: { en: 'Homework', bn: 'হোমওয়ার্ক' },
  },
  {
    // Optional: exactly one of section/student is set (D24).
    key: 'section',
    type: 'ref',
    ref: 'sections',
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'assigned_date',
    type: 'date',
    required: true,
    label: { en: 'Assigned date', bn: 'নির্ধারিত তারিখ' },
  },
  { key: 'due_date', type: 'date', required: true, label: { en: 'Due date', bn: 'শেষ তারিখ' } },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(HomeworkAssignmentStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
];

const excluded: readonly string[] = [
  'homework_id', // exported instead as the `homework` ref column
  'section_id', // exported instead as the `section` ref column
  'student_id', // exported instead as the `student` ref column, keyed by registration_number
];

export const homeworkAssignmentTab: TabSpec<HomeworkAssignment, HomeworkAssignmentRow> = {
  name: 'homework_assignments',
  entity: HomeworkAssignment,
  excluded,
  dependsOn: ['homework', 'sections', 'students'],
  columns,
  naturalKey: ['homework', 'section', 'student', 'assigned_date'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<HomeworkAssignment[]> {
    return m.find(HomeworkAssignment, {
      where: { tenant_id: tenantId },
      // Nested `.academic_year` is required on both branches: `keyOf` calls
      // `homeworkTab.keyOf`/`sectionsTab.keyOf`, which each read
      // `klass.academic_year?.name` (see homework.tab.ts/sections.tab.ts).
      relations: [
        'homework',
        'homework.klass',
        'homework.klass.academic_year',
        'homework.subject',
        'section',
        'section.class',
        'section.class.academic_year',
        'student',
      ],
    });
  },

  toRow(entity: HomeworkAssignment, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      homework: ctx.keyOf('homework', entity.homework_id),
      section: entity.section_id ? ctx.keyOf('sections', entity.section_id) : null,
      student: entity.student_id ? ctx.keyOf('students', entity.student_id) : null,
      assigned_date: entity.assigned_date,
      due_date: entity.due_date,
      status: entity.status,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: HomeworkAssignmentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'homework_assignments', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const homeworkKey = values.homework as string;
    const homeworkId = ctx.ref('homework', homeworkKey);
    if (!homeworkId) {
      errors.push({
        tab: 'homework_assignments',
        row: rowNo,
        column: 'homework',
        message: `Column "homework": no homework with the key "${homeworkKey}" was found.`,
        severity: 'error',
        value: homeworkKey,
      });
    }

    const sectionKey = (values.section as string | null) ?? '';
    let sectionId: string | null = null;
    if (sectionKey) {
      const resolved = ctx.ref('sections', sectionKey);
      if (!resolved) {
        errors.push({
          tab: 'homework_assignments',
          row: rowNo,
          column: 'section',
          message: `Column "section": no section with the key "${sectionKey}" was found.`,
          severity: 'error',
          value: sectionKey,
        });
      } else {
        sectionId = resolved;
      }
    }

    const studentKey = (values.student as string | null) ?? '';
    let studentId: string | null = null;
    if (studentKey) {
      const resolved = ctx.ref('students', studentKey);
      if (!resolved) {
        errors.push({
          tab: 'homework_assignments',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student with registration number "${studentKey}" was found.`,
          severity: 'error',
          value: studentKey,
        });
      } else {
        studentId = resolved;
      }
    }

    if (errors.length > 0) return { errors };

    // D24: exactly one of section/student, mirroring the entity's own
    // `CHECK` constraint at the codec layer instead of only at the DB.
    if ((sectionId === null) === (studentId === null)) {
      errors.push({
        tab: 'homework_assignments',
        row: rowNo,
        column: 'section',
        message: 'Exactly one of "section" or "student" must be set, never both or neither (D24).',
        severity: 'error',
        value: `${sectionKey}|${studentKey}`,
      });
      return { errors };
    }

    return {
      row: {
        id: values.id as string,
        homework_id: homeworkId as string,
        section_id: sectionId,
        student_id: studentId,
        assigned_date: values.assigned_date as string,
        due_date: values.due_date as string,
        status: values.status as HomeworkAssignmentStatus,
        homework_key: homeworkKey,
        section_key: sectionKey,
        student_key: studentKey,
      },
    };
  },

  keyOf(x: HomeworkAssignmentRow | HomeworkAssignment): string {
    const homeworkKey =
      x instanceof HomeworkAssignment
        ? x.homework
          ? homeworkTab.keyOf(x.homework)
          : ''
        : x.homework_key;
    const sectionKey =
      x instanceof HomeworkAssignment
        ? x.section
          ? sectionsTab.keyOf(x.section)
          : ''
        : x.section_key;
    const studentKey =
      x instanceof HomeworkAssignment
        ? x.student
          ? studentsTab.keyOf(x.student)
          : ''
        : x.student_key;
    return `${homeworkKey}|${sectionKey}|${studentKey}|${x.assigned_date}`;
  },

  diffFields(row: HomeworkAssignmentRow, existing: HomeworkAssignment): string[] {
    const changed: string[] = [];
    if (row.homework_id !== existing.homework_id) changed.push('homework');
    if (row.section_id !== existing.section_id) changed.push('section');
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.due_date !== existing.due_date) changed.push('due_date');
    if (row.status !== existing.status) changed.push('status');
    return changed;
  },

  async upsert(
    row: HomeworkAssignmentRow,
    existing: HomeworkAssignment | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<HomeworkAssignment> {
    const assignment = existing ?? new HomeworkAssignment();
    assignment.tenant_id = tenantId;
    assignment.homework_id = row.homework_id;
    assignment.section_id = row.section_id;
    assignment.student_id = row.student_id;
    assignment.assigned_date = row.assigned_date;
    assignment.due_date = row.due_date;
    assignment.status = row.status;
    return m.save(HomeworkAssignment, assignment);
  },

  async remove(entity: HomeworkAssignment, m: EntityManager): Promise<void> {
    await m.remove(HomeworkAssignment, entity);
  },
};
