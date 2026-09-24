import type { EntityManager } from 'typeorm';
import { Result } from '../../../exams/entities/result.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { examsTab } from './exams.tab';
import { studentsTab } from '../people/students.tab';
import { gradingScalesTab } from '../grading/grading-scales.tab';

/**
 * The `results` tab: one student's computed result for one exam — `Result`
 * (19.2.1, D19). Soft-deletable, following `deleteByAbsence: true`.
 *
 * `grading_scale_id`, `grading_scale_revision`, and `rule_version` are the
 * D19 pin: exported and restored as plain values, never re-derived from the
 * scale's *current* state. A restore that dropped `grading_scale_revision`
 * back to whatever the scale's row happens to be at today would let a later
 * scale edit silently re-grade an already-printed, historical result — the
 * exact bug this ticket's Tests section calls out by name.
 */

export interface ResultRow {
  id: string;
  exam_id: string;
  exam_key: string;
  student_id: string;
  student_key: string;
  total_marks: string;
  gpa: string;
  grade: string;
  position: number | null;
  is_fail: boolean;
  grading_scale_id: string;
  grading_scale_key: string;
  grading_scale_revision: number;
  rule_version: string;
  computed_at: string;
  published_at: string | null;
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
    key: 'total_marks',
    type: 'money',
    required: true,
    label: { en: 'Total marks', bn: 'মোট নম্বর' },
  },
  { key: 'gpa', type: 'money', required: true, label: { en: 'GPA', bn: 'জিপিএ' } },
  { key: 'grade', type: 'string', required: true, label: { en: 'Grade', bn: 'গ্রেড' } },
  { key: 'position', type: 'int', label: { en: 'Position', bn: 'অবস্থান' } },
  { key: 'is_fail', type: 'bool', required: true, label: { en: 'Failed', bn: 'ফেল' } },
  {
    key: 'grading_scale',
    type: 'ref',
    ref: 'grading_scales',
    required: true,
    label: { en: 'Grading scale', bn: 'গ্রেডিং স্কেল' },
  },
  // D19 pin — see docstring. Exported/restored exactly, never re-derived.
  {
    key: 'grading_scale_revision',
    type: 'int',
    required: true,
    label: { en: 'Scale revision', bn: 'স্কেল সংশোধন' },
  },
  {
    key: 'rule_version',
    type: 'string',
    required: true,
    label: { en: 'Rule version', bn: 'নিয়ম সংস্করণ' },
  },
  {
    key: 'computed_at',
    type: 'datetime',
    required: true,
    label: { en: 'Computed at', bn: 'গণনার সময়' },
  },
  { key: 'published_at', type: 'datetime', label: { en: 'Published at', bn: 'প্রকাশের সময়' } },
];

const excluded: readonly string[] = [
  'exam_id', // exported instead as the `exam` ref column
  'student_id', // exported instead as the `student` ref column
  'grading_scale_id', // exported instead as the `grading_scale` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  grade: 10,
  rule_version: 50,
};

export const resultsTab: TabSpec<Result, ResultRow> = {
  name: 'results',
  entity: Result,
  excluded,
  dependsOn: ['exams', 'students', 'grading_scales'],
  columns,
  naturalKey: ['exam', 'student'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Result[]> {
    return m.find(Result, {
      where: { tenant_id: tenantId },
      relations: [
        'exam',
        'exam.academic_year',
        'exam.class',
        'exam.class.academic_year',
        'student',
        'grading_scale',
        'grading_scale.academic_year',
        'grading_scale.class',
        'grading_scale.class.academic_year',
      ],
    });
  },

  toRow(entity: Result, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      exam: ctx.keyOf('exams', entity.exam_id),
      student: ctx.keyOf('students', entity.student_id),
      total_marks: entity.total_marks,
      gpa: entity.gpa,
      grade: entity.grade,
      position: entity.position,
      is_fail: entity.is_fail,
      grading_scale: ctx.keyOf('grading_scales', entity.grading_scale_id),
      // Pinned values, exported as-is (D19) — never the scale's current
      // `revision`.
      grading_scale_revision: entity.grading_scale_revision,
      rule_version: entity.rule_version,
      computed_at: entity.computed_at,
      published_at: entity.published_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ResultRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'results', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'results',
          row: rowNo,
          column: column.key,
          message: `Column "${column.key}": is longer than the ${limit} characters allowed.`,
          severity: 'error',
          value: raw,
        });
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
          tab: 'results',
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
          tab: 'results',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student "${studentKey}" was found.`,
          severity: 'error',
          value: studentKey,
        });
      }
    }

    let gradingScaleId: string | undefined;
    const gradingScaleKey = values.grading_scale as string;
    if (gradingScaleKey) {
      gradingScaleId = ctx.ref('grading_scales', gradingScaleKey);
      if (!gradingScaleId) {
        errors.push({
          tab: 'results',
          row: rowNo,
          column: 'grading_scale',
          message: `Column "grading_scale": no grading scale "${gradingScaleKey}" was found.`,
          severity: 'error',
          value: gradingScaleKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        exam_id: examId as string,
        exam_key: examKey,
        student_id: studentId as string,
        student_key: studentKey,
        total_marks: values.total_marks as string,
        gpa: values.gpa as string,
        grade: values.grade as string,
        position: (values.position as number | null) ?? null,
        is_fail: values.is_fail as boolean,
        grading_scale_id: gradingScaleId as string,
        grading_scale_key: gradingScaleKey,
        // D19 pin: taken from the cell exactly, never recomputed from the
        // referenced scale's current row.
        grading_scale_revision: values.grading_scale_revision as number,
        rule_version: values.rule_version as string,
        computed_at: values.computed_at as string,
        published_at: (values.published_at as string | null) ?? null,
      },
    };
  },

  keyOf(x: ResultRow | Result): string {
    const examKey = x instanceof Result ? (x.exam ? examsTab.keyOf(x.exam) : '') : x.exam_key;
    const studentKey =
      x instanceof Result ? (x.student ? studentsTab.keyOf(x.student) : '') : x.student_key;
    return `${examKey}|${studentKey}`;
  },

  diffFields(row: ResultRow, existing: Result): string[] {
    const changed: string[] = [];
    if (row.exam_id !== existing.exam_id) changed.push('exam');
    if (row.student_id !== existing.student_id) changed.push('student');
    if (String(row.total_marks) !== String(existing.total_marks)) changed.push('total_marks');
    if (String(row.gpa) !== String(existing.gpa)) changed.push('gpa');
    if (row.grade !== existing.grade) changed.push('grade');
    if ((row.position ?? null) !== (existing.position ?? null)) changed.push('position');
    if (row.is_fail !== existing.is_fail) changed.push('is_fail');
    if (row.grading_scale_id !== existing.grading_scale_id) changed.push('grading_scale');
    if (row.grading_scale_revision !== existing.grading_scale_revision) {
      changed.push('grading_scale_revision');
    }
    if (row.rule_version !== existing.rule_version) changed.push('rule_version');
    if (row.computed_at !== existing.computed_at.toISOString()) changed.push('computed_at');
    const rowPublished = row.published_at ?? null;
    const existingPublished = existing.published_at ? existing.published_at.toISOString() : null;
    if (rowPublished !== existingPublished) changed.push('published_at');
    return changed;
  },

  async upsert(
    row: ResultRow,
    existing: Result | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Result> {
    const result = existing ?? new Result();
    result.tenant_id = tenantId;
    result.exam_id = row.exam_id;
    result.student_id = row.student_id;
    result.total_marks = row.total_marks;
    result.gpa = row.gpa;
    result.grade = row.grade;
    result.position = row.position;
    result.is_fail = row.is_fail;
    result.grading_scale_id = row.grading_scale_id;
    // Written explicitly: these two must never be re-derived from the
    // referenced scale's current row (D19).
    result.grading_scale_revision = row.grading_scale_revision;
    result.rule_version = row.rule_version;
    result.computed_at = new Date(row.computed_at);
    result.published_at = row.published_at ? new Date(row.published_at) : null;

    return m.save(Result, result);
  },

  async remove(entity: Result, m: EntityManager): Promise<void> {
    await m.softRemove(Result, entity);
  },
};
