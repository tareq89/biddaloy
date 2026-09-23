import type { EntityManager } from 'typeorm';
import { ResultSubject } from '../../../exams/entities/result-subject.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { resultsTab } from './results.tab';

/**
 * The `result_subjects` tab: one subject's line within a `Result` — the
 * per-subject breakdown a report card prints (19.2.1). Soft-deletable in
 * lockstep with its parent `Result`.
 */

export interface ResultSubjectRow {
  id: string;
  result_id: string;
  result_key: string;
  subject_id: string;
  subject_key: string;
  obtained: string;
  grade: string;
  gpa: string;
  is_fail: boolean;
  is_fourth_subject: boolean;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'result',
    type: 'ref',
    ref: 'results',
    required: true,
    label: { en: 'Result', bn: 'ফলাফল' },
  },
  {
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  {
    key: 'obtained',
    type: 'money',
    required: true,
    label: { en: 'Obtained', bn: 'প্রাপ্ত নম্বর' },
  },
  { key: 'grade', type: 'string', required: true, label: { en: 'Grade', bn: 'গ্রেড' } },
  { key: 'gpa', type: 'money', required: true, label: { en: 'GPA', bn: 'জিপিএ' } },
  { key: 'is_fail', type: 'bool', required: true, label: { en: 'Failed', bn: 'ফেল' } },
  {
    key: 'is_fourth_subject',
    type: 'bool',
    required: true,
    label: { en: 'Fourth subject', bn: 'চতুর্থ বিষয়' },
  },
];

const excluded: readonly string[] = [
  'result_id', // exported instead as the `result` ref column
  'subject_id', // exported instead as the `subject` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  grade: 10,
};

export const resultSubjectsTab: TabSpec<ResultSubject, ResultSubjectRow> = {
  name: 'result_subjects',
  entity: ResultSubject,
  excluded,
  dependsOn: ['results', 'subjects'],
  columns,
  naturalKey: ['result', 'subject'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ResultSubject[]> {
    return m.find(ResultSubject, {
      where: { tenant_id: tenantId },
      relations: [
        'result',
        'result.exam',
        'result.exam.academic_year',
        'result.exam.class',
        'result.exam.class.academic_year',
        'result.student',
        'subject',
      ],
    });
  },

  toRow(entity: ResultSubject, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      result: ctx.keyOf('results', entity.result_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      obtained: entity.obtained,
      grade: entity.grade,
      gpa: entity.gpa,
      is_fail: entity.is_fail,
      is_fourth_subject: entity.is_fourth_subject,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ResultSubjectRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'result_subjects', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'result_subjects',
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

    let resultId: string | undefined;
    const resultKey = values.result as string;
    if (resultKey) {
      resultId = ctx.ref('results', resultKey);
      if (!resultId) {
        errors.push({
          tab: 'result_subjects',
          row: rowNo,
          column: 'result',
          message: `Column "result": no result "${resultKey}" was found.`,
          severity: 'error',
          value: resultKey,
        });
      }
    }

    let subjectId: string | undefined;
    const subjectKey = values.subject as string;
    if (subjectKey) {
      subjectId = ctx.ref('subjects', subjectKey);
      if (!subjectId) {
        errors.push({
          tab: 'result_subjects',
          row: rowNo,
          column: 'subject',
          message: `Column "subject": no subject "${subjectKey}" was found.`,
          severity: 'error',
          value: subjectKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        result_id: resultId as string,
        result_key: resultKey,
        subject_id: subjectId as string,
        subject_key: subjectKey,
        obtained: values.obtained as string,
        grade: values.grade as string,
        gpa: values.gpa as string,
        is_fail: values.is_fail as boolean,
        is_fourth_subject: values.is_fourth_subject as boolean,
      },
    };
  },

  keyOf(x: ResultSubjectRow | ResultSubject): string {
    const resultKey =
      x instanceof ResultSubject ? (x.result ? resultsTab.keyOf(x.result) : '') : x.result_key;
    const subjectKey = x instanceof ResultSubject ? (x.subject?.code ?? '') : x.subject_key;
    return `${resultKey}|${subjectKey}`;
  },

  diffFields(row: ResultSubjectRow, existing: ResultSubject): string[] {
    const changed: string[] = [];
    if (row.result_id !== existing.result_id) changed.push('result');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (String(row.obtained) !== String(existing.obtained)) changed.push('obtained');
    if (row.grade !== existing.grade) changed.push('grade');
    if (String(row.gpa) !== String(existing.gpa)) changed.push('gpa');
    if (row.is_fail !== existing.is_fail) changed.push('is_fail');
    if (row.is_fourth_subject !== existing.is_fourth_subject) changed.push('is_fourth_subject');
    return changed;
  },

  async upsert(
    row: ResultSubjectRow,
    existing: ResultSubject | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ResultSubject> {
    const line = existing ?? new ResultSubject();
    line.tenant_id = tenantId;
    line.result_id = row.result_id;
    line.subject_id = row.subject_id;
    line.obtained = row.obtained;
    line.grade = row.grade;
    line.gpa = row.gpa;
    line.is_fail = row.is_fail;
    line.is_fourth_subject = row.is_fourth_subject;

    return m.save(ResultSubject, line);
  },

  async remove(entity: ResultSubject, m: EntityManager): Promise<void> {
    await m.softRemove(ResultSubject, entity);
  },
};
