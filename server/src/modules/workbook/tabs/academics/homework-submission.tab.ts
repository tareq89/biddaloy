import type { EntityManager } from 'typeorm';
import { HomeworkSubmissionStatus } from '@biddaloy/shared';
import { HomeworkSubmission } from '../../../homework/entities/homework-submission.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { homeworkAssignmentTab } from './homework-assignment.tab';
import { studentsTab } from '../people/students.tab';

/**
 * The `homework_submissions` tab (Epic 22.0, [22.3.6]). One row per
 * (assignment, student) — the same uniqueness the entity's own index
 * enforces (D19).
 */
export interface HomeworkSubmissionRow {
  id: string;
  assignment_id: string;
  student_id: string;
  status: HomeworkSubmissionStatus;
  marks: number | null;
  attachments: unknown[];
  assignment_key: string;
  student_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'assignment',
    type: 'ref',
    ref: 'homework_assignments',
    required: true,
    label: { en: 'Assignment', bn: 'নির্ধারণ' },
  },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(HomeworkSubmissionStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  { key: 'marks', type: 'int', label: { en: 'Marks', bn: 'নম্বর' } },
  { key: 'attachments', type: 'json', label: { en: 'Attachments', bn: 'সংযুক্তি' } },
];

const excluded: readonly string[] = [
  'assignment_id', // exported instead as the `assignment` ref column
  'student_id', // exported instead as the `student` ref column, keyed by registration_number
];

export const homeworkSubmissionTab: TabSpec<HomeworkSubmission, HomeworkSubmissionRow> = {
  name: 'homework_submissions',
  entity: HomeworkSubmission,
  excluded,
  dependsOn: ['homework_assignments', 'students'],
  columns,
  naturalKey: ['assignment', 'student'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<HomeworkSubmission[]> {
    return m.find(HomeworkSubmission, {
      where: { tenant_id: tenantId },
      relations: [
        'assignment',
        'assignment.homework',
        'assignment.homework.klass',
        'assignment.homework.klass.academic_year',
        'assignment.homework.subject',
        'assignment.section',
        'assignment.section.class',
        'assignment.section.class.academic_year',
        'assignment.student',
        'student',
      ],
    });
  },

  toRow(entity: HomeworkSubmission, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      assignment: ctx.keyOf('homework_assignments', entity.assignment_id),
      student: ctx.keyOf('students', entity.student_id),
      status: entity.status,
      marks: entity.marks,
      attachments: entity.attachments ?? [],
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: HomeworkSubmissionRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'homework_submissions', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const assignmentKey = values.assignment as string;
    const assignmentId = ctx.ref('homework_assignments', assignmentKey);
    if (!assignmentId) {
      errors.push({
        tab: 'homework_submissions',
        row: rowNo,
        column: 'assignment',
        message: `Column "assignment": no assignment with the key "${assignmentKey}" was found.`,
        severity: 'error',
        value: assignmentKey,
      });
    }

    const studentKey = values.student as string;
    const studentId = ctx.ref('students', studentKey);
    if (!studentId) {
      errors.push({
        tab: 'homework_submissions',
        row: rowNo,
        column: 'student',
        message: `Column "student": no student with registration number "${studentKey}" was found.`,
        severity: 'error',
        value: studentKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        assignment_id: assignmentId as string,
        student_id: studentId as string,
        status: values.status as HomeworkSubmissionStatus,
        marks: (values.marks as number | null) ?? null,
        attachments: (values.attachments as unknown[] | null) ?? [],
        assignment_key: assignmentKey,
        student_key: studentKey,
      },
    };
  },

  keyOf(x: HomeworkSubmissionRow | HomeworkSubmission): string {
    const assignmentKey =
      x instanceof HomeworkSubmission
        ? x.assignment
          ? homeworkAssignmentTab.keyOf(x.assignment)
          : ''
        : x.assignment_key;
    const studentKey =
      x instanceof HomeworkSubmission
        ? x.student
          ? studentsTab.keyOf(x.student)
          : ''
        : x.student_key;
    return `${assignmentKey}|${studentKey}`;
  },

  diffFields(row: HomeworkSubmissionRow, existing: HomeworkSubmission): string[] {
    const changed: string[] = [];
    if (row.status !== existing.status) changed.push('status');
    if (row.marks !== existing.marks) changed.push('marks');
    if (JSON.stringify(row.attachments) !== JSON.stringify(existing.attachments)) {
      changed.push('attachments');
    }
    return changed;
  },

  async upsert(
    row: HomeworkSubmissionRow,
    existing: HomeworkSubmission | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<HomeworkSubmission> {
    const submission = existing ?? new HomeworkSubmission();
    submission.tenant_id = tenantId;
    submission.assignment_id = row.assignment_id;
    submission.student_id = row.student_id;
    submission.status = row.status;
    submission.marks = row.marks;
    submission.attachments = row.attachments;
    return m.save(HomeworkSubmission, submission);
  },

  async remove(entity: HomeworkSubmission, m: EntityManager): Promise<void> {
    await m.remove(HomeworkSubmission, entity);
  },
};
