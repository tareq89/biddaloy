import type { EntityManager } from 'typeorm';
import { StudentSubjectChoice } from '../../../students/entities/student-subject-choice.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { studentsTab } from '../people/students.tab';
import { classSubjectsTab } from '../academics/class-subjects.tab';
import { ClassSubject } from '../../../academics/entities/class-subject.entity';

/**
 * The `student_subject_choices` tab: a student's fourth/optional subject
 * choice — `StudentSubjectChoice` (19.2.1, D14). No soft delete on the
 * entity, so `remove` hard-deletes.
 *
 * `academic_year_id` is excluded: it is a denormalised copy of
 * `class_subject.academic_year_id` (see the entity docstring) that the
 * write path always derives from the chosen `class_subject`, never sets
 * independently — carrying it as a second ref column here would let a
 * malformed workbook row disagree with its own `class_subject` choice.
 * `upsert` derives it the same way the live write path does.
 */

export interface StudentSubjectChoiceRow {
  id: string;
  student_id: string;
  student_key: string;
  class_subject_id: string;
  class_subject_key: string;
  is_fourth: boolean;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'class_subject',
    type: 'ref',
    ref: 'class_subjects',
    required: true,
    label: { en: 'Class subject', bn: 'শ্রেণী বিষয়' },
  },
  {
    key: 'is_fourth',
    type: 'bool',
    required: true,
    label: { en: 'Fourth subject', bn: 'চতুর্থ বিষয়' },
  },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
  'class_subject_id', // exported instead as the `class_subject` ref column
  'academic_year_id', // denormalised from `class_subject` — see docstring
];

export const studentSubjectChoicesTab: TabSpec<StudentSubjectChoice, StudentSubjectChoiceRow> = {
  name: 'student_subject_choices',
  entity: StudentSubjectChoice,
  excluded,
  dependsOn: ['students', 'class_subjects'],
  columns,
  naturalKey: ['student', 'class_subject'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StudentSubjectChoice[]> {
    return m.find(StudentSubjectChoice, {
      where: { tenant_id: tenantId },
      relations: [
        'student',
        'class_subject',
        'class_subject.class',
        'class_subject.class.academic_year',
        'class_subject.academic_year',
        'class_subject.subject',
      ],
    });
  },

  toRow(entity: StudentSubjectChoice, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      class_subject: ctx.keyOf('class_subjects', entity.class_subject_id),
      is_fourth: entity.is_fourth,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudentSubjectChoiceRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'student_subject_choices', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let studentId: string | undefined;
    const studentKey = values.student as string;
    if (studentKey) {
      studentId = ctx.ref('students', studentKey);
      if (!studentId) {
        errors.push({
          tab: 'student_subject_choices',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student "${studentKey}" was found.`,
          severity: 'error',
          value: studentKey,
        });
      }
    }

    let classSubjectId: string | undefined;
    const classSubjectKey = values.class_subject as string;
    if (classSubjectKey) {
      classSubjectId = ctx.ref('class_subjects', classSubjectKey);
      if (!classSubjectId) {
        errors.push({
          tab: 'student_subject_choices',
          row: rowNo,
          column: 'class_subject',
          message: `Column "class_subject": no class subject "${classSubjectKey}" was found.`,
          severity: 'error',
          value: classSubjectKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        student_id: studentId as string,
        student_key: studentKey,
        class_subject_id: classSubjectId as string,
        class_subject_key: classSubjectKey,
        is_fourth: values.is_fourth as boolean,
      },
    };
  },

  keyOf(x: StudentSubjectChoiceRow | StudentSubjectChoice): string {
    const studentKey =
      x instanceof StudentSubjectChoice
        ? x.student
          ? studentsTab.keyOf(x.student)
          : ''
        : x.student_key;
    const classSubjectKey =
      x instanceof StudentSubjectChoice
        ? x.class_subject
          ? classSubjectsTab.keyOf(x.class_subject)
          : ''
        : x.class_subject_key;
    return `${studentKey}|${classSubjectKey}`;
  },

  diffFields(row: StudentSubjectChoiceRow, existing: StudentSubjectChoice): string[] {
    const changed: string[] = [];
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.class_subject_id !== existing.class_subject_id) changed.push('class_subject');
    if (row.is_fourth !== existing.is_fourth) changed.push('is_fourth');
    return changed;
  },

  async upsert(
    row: StudentSubjectChoiceRow,
    existing: StudentSubjectChoice | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StudentSubjectChoice> {
    const choice = existing ?? new StudentSubjectChoice();
    choice.tenant_id = tenantId;
    choice.student_id = row.student_id;
    choice.class_subject_id = row.class_subject_id;
    // Derived from the chosen class_subject, same as the live write path —
    // never set independently (see docstring / `excluded`).
    const classSubject = await m.findOneOrFail(ClassSubject, {
      where: { id: row.class_subject_id },
    });
    choice.academic_year_id = classSubject.academic_year_id;
    choice.is_fourth = row.is_fourth;

    return m.save(StudentSubjectChoice, choice);
  },

  async remove(entity: StudentSubjectChoice, m: EntityManager): Promise<void> {
    await m.delete(StudentSubjectChoice, { id: entity.id });
  },
};
