import type { EntityManager } from 'typeorm';
import { Mark } from '../../../exams/entities/mark.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { examsTab } from './exams.tab';
import { examComponentsTab } from './exam-components.tab';
import { studentsTab } from '../people/students.tab';

/**
 * The `marks` tab: one student's entered mark for one exam component —
 * `Mark` (19.2.1). No soft delete on the entity, so `remove` hard-deletes.
 *
 * D10 is the reason this tab exists in the ticket's own words: a mark with
 * `status = ABSENT` must round-trip with `value = null`, never a zero. That
 * is a DB CHECK constraint on the entity (`CHK_marks_value_only_when_present`)
 * — this tab does not re-validate it, it just must never coerce a null
 * `value` into anything else on either export or import. `value`'s column
 * type is `money`, and `toCell`/`fromCell` already pass `null` straight
 * through for every type (see `cell-format.ts`), so no special-casing is
 * needed here beyond not defaulting the value.
 *
 * `entered_by` has no FK relation on the entity (a plain nullable uuid), so
 * it is carried through as a raw `uuid` column rather than a `ref`.
 */

export interface MarkRow {
  id: string;
  exam_id: string;
  exam_key: string;
  student_id: string;
  student_key: string;
  subject_id: string;
  subject_key: string;
  component_id: string;
  component_key: string;
  value: string | null;
  status: string;
  entered_by: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'exam', type: 'ref', ref: 'exams', required: true, label: { en: 'Exam', bn: 'পরীক্ষা' } },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  {
    key: 'component',
    type: 'ref',
    ref: 'exam_components',
    required: true,
    label: { en: 'Component', bn: 'উপাদান' },
  },
  // Deliberately no `required: true` — null whenever `status` is not
  // PRESENT (D10). See docstring above.
  { key: 'value', type: 'money', label: { en: 'Value', bn: 'নম্বর' } },
  {
    key: 'status',
    type: 'enum',
    enumValues: ['PRESENT', 'ABSENT', 'EXEMPT'],
    required: true,
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  { key: 'entered_by', type: 'uuid', label: { en: 'Entered by', bn: 'যিনি দিয়েছেন' } },
];

const excluded: readonly string[] = [
  'exam_id', // exported instead as the `exam` ref column
  'student_id', // exported instead as the `student` ref column
  'subject_id', // exported instead as the `subject` ref column
  'component_id', // exported instead as the `component` ref column
];

export const marksTab: TabSpec<Mark, MarkRow> = {
  name: 'marks',
  entity: Mark,
  excluded,
  dependsOn: ['exams', 'students', 'subjects', 'exam_components'],
  columns,
  naturalKey: ['exam', 'student', 'component'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Mark[]> {
    return m.find(Mark, {
      where: { tenant_id: tenantId },
      relations: [
        'exam',
        'exam.academic_year',
        'exam.class',
        'exam.class.academic_year',
        'student',
        'subject',
        'component',
        'component.exam',
        'component.exam.academic_year',
        'component.exam.class',
        'component.exam.class.academic_year',
        'component.subject',
      ],
    });
  },

  toRow(entity: Mark, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      exam: ctx.keyOf('exams', entity.exam_id),
      student: ctx.keyOf('students', entity.student_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      component: ctx.keyOf('exam_components', entity.component_id),
      // Never defaulted: a null `value` must reach the cell as `null`, not
      // a coerced zero (D10).
      value: entity.value,
      status: entity.status,
      entered_by: entity.entered_by,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: MarkRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'marks', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let examId: string | undefined;
    const examKey = values.exam as string;
    if (examKey) {
      examId = ctx.ref('exams', examKey);
      if (!examId) {
        errors.push({
          tab: 'marks',
          row: rowNo,
          column: 'exam',
          message: `Column "exam": no exam "${examKey}" was found.`,
          severity: 'error',
          value: examKey,
        });
      }
    }

    let studentId: string | undefined;
    const studentKey = values.student as string;
    if (studentKey) {
      studentId = ctx.ref('students', studentKey);
      if (!studentId) {
        errors.push({
          tab: 'marks',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student "${studentKey}" was found.`,
          severity: 'error',
          value: studentKey,
        });
      }
    }

    let subjectId: string | undefined;
    const subjectKey = values.subject as string;
    if (subjectKey) {
      subjectId = ctx.ref('subjects', subjectKey);
      if (!subjectId) {
        errors.push({
          tab: 'marks',
          row: rowNo,
          column: 'subject',
          message: `Column "subject": no subject "${subjectKey}" was found.`,
          severity: 'error',
          value: subjectKey,
        });
      }
    }

    let componentId: string | undefined;
    const componentKey = values.component as string;
    if (componentKey) {
      componentId = ctx.ref('exam_components', componentKey);
      if (!componentId) {
        errors.push({
          tab: 'marks',
          row: rowNo,
          column: 'component',
          message: `Column "component": no exam component "${componentKey}" was found.`,
          severity: 'error',
          value: componentKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    // D10 guard: a non-PRESENT status must carry a null value on import too
    // — an ABSENT row with a filled `value` cell would otherwise pass
    // through to `upsert` and trip the DB check constraint with a less
    // useful error than this one.
    const status = values.status as string;
    const value = (values.value as string | null) ?? null;
    if (status !== 'PRESENT' && value !== null) {
      return {
        errors: [
          {
            tab: 'marks',
            row: rowNo,
            column: 'value',
            message: `Column "value": must be empty when status is "${status}".`,
            severity: 'error',
            value: cells.value ?? '',
          },
        ],
      };
    }

    return {
      row: {
        id: values.id as string,
        exam_id: examId as string,
        exam_key: examKey,
        student_id: studentId as string,
        student_key: studentKey,
        subject_id: subjectId as string,
        subject_key: subjectKey,
        component_id: componentId as string,
        component_key: componentKey,
        value,
        status,
        entered_by: (values.entered_by as string | null) ?? null,
      },
    };
  },

  keyOf(x: MarkRow | Mark): string {
    const examKey = x instanceof Mark ? (x.exam ? examsTab.keyOf(x.exam) : '') : x.exam_key;
    const studentKey =
      x instanceof Mark ? (x.student ? studentsTab.keyOf(x.student) : '') : x.student_key;
    const componentKey =
      x instanceof Mark
        ? x.component
          ? examComponentsTab.keyOf(x.component)
          : ''
        : x.component_key;
    return `${examKey}|${studentKey}|${componentKey}`;
  },

  diffFields(row: MarkRow, existing: Mark): string[] {
    const changed: string[] = [];
    if (row.exam_id !== existing.exam_id) changed.push('exam');
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.component_id !== existing.component_id) changed.push('component');
    if (String(row.value ?? '') !== String(existing.value ?? '')) changed.push('value');
    if (row.status !== existing.status) changed.push('status');
    if ((row.entered_by ?? null) !== (existing.entered_by ?? null)) changed.push('entered_by');
    return changed;
  },

  async upsert(
    row: MarkRow,
    existing: Mark | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Mark> {
    const mark = existing ?? new Mark();
    mark.tenant_id = tenantId;
    mark.exam_id = row.exam_id;
    mark.student_id = row.student_id;
    mark.subject_id = row.subject_id;
    mark.component_id = row.component_id;
    mark.value = row.value;
    mark.status = row.status as Mark['status'];
    mark.entered_by = row.entered_by;

    return m.save(Mark, mark);
  },

  async remove(entity: Mark, m: EntityManager): Promise<void> {
    await m.delete(Mark, { id: entity.id });
  },
};
