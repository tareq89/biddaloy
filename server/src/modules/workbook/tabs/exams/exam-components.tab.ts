import type { EntityManager } from 'typeorm';
import { ExamComponent } from '../../../exams/entities/exam-component.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { examsTab } from './exams.tab';

/**
 * The `exam_components` tab: one markable part of one exam-subject (e.g.
 * "Written" for the Physics component of a Term Exam) — `ExamComponent`
 * (19.2.1). `source = DERIVED` (currently only `ATTENDANCE`, D11) exports
 * and restores the same as `MANUAL`; nothing here computes derived marks,
 * this tab only backs up the component's own configuration.
 */

export interface ExamComponentRow {
  id: string;
  exam_id: string;
  exam_key: string;
  subject_id: string;
  subject_key: string;
  name: string;
  kind: string;
  source: string;
  full_marks: string;
  pass_marks: string | null;
  sequence: number;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'exam', type: 'ref', ref: 'exams', required: true, label: { en: 'Exam', bn: 'পরীক্ষা' } },
  {
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'kind',
    type: 'enum',
    enumValues: [
      'WRITTEN',
      'MCQ',
      'VIVA',
      'LAB',
      'PRACTICAL',
      'MONTHLY_TEST',
      'ATTENDANCE',
      'OTHER',
    ],
    required: true,
    label: { en: 'Kind', bn: 'ধরন' },
  },
  {
    key: 'source',
    type: 'enum',
    enumValues: ['MANUAL', 'DERIVED'],
    required: true,
    label: { en: 'Source', bn: 'উৎস' },
  },
  {
    key: 'full_marks',
    type: 'money',
    required: true,
    label: { en: 'Full marks', bn: 'পূর্ণমান' },
  },
  { key: 'pass_marks', type: 'money', label: { en: 'Pass marks', bn: 'পাস নম্বর' } },
  { key: 'sequence', type: 'int', required: true, label: { en: 'Sequence', bn: 'ক্রম' } },
];

const excluded: readonly string[] = [
  'exam_id', // exported instead as the `exam` ref column
  'subject_id', // exported instead as the `subject` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  name: 200,
};

export const examComponentsTab: TabSpec<ExamComponent, ExamComponentRow> = {
  name: 'exam_components',
  entity: ExamComponent,
  excluded,
  dependsOn: ['exams', 'subjects'],
  columns,
  naturalKey: ['exam', 'subject', 'name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ExamComponent[]> {
    return m.find(ExamComponent, {
      where: { tenant_id: tenantId },
      relations: [
        'exam',
        'exam.academic_year',
        'exam.class',
        'exam.class.academic_year',
        'subject',
      ],
    });
  },

  toRow(entity: ExamComponent, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      exam: ctx.keyOf('exams', entity.exam_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      name: entity.name,
      kind: entity.kind,
      source: entity.source,
      full_marks: entity.full_marks,
      pass_marks: entity.pass_marks,
      sequence: entity.sequence,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ExamComponentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'exam_components', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'exam_components',
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
          tab: 'exam_components',
          row: rowNo,
          column: 'exam',
          message: `Column "exam": no exam "${examKey}" was found.`,
          severity: 'error',
          value: examKey,
        });
      }
    }

    let subjectId: string | undefined;
    const subjectKey = values.subject as string;
    if (subjectKey) {
      subjectId = ctx.ref('subjects', subjectKey);
      if (!subjectId) {
        errors.push({
          tab: 'exam_components',
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
        exam_id: examId as string,
        exam_key: examKey,
        subject_id: subjectId as string,
        subject_key: subjectKey,
        name: values.name as string,
        kind: values.kind as string,
        source: values.source as string,
        full_marks: values.full_marks as string,
        pass_marks: (values.pass_marks as string | null) ?? null,
        sequence: values.sequence as number,
      },
    };
  },

  keyOf(x: ExamComponentRow | ExamComponent): string {
    const examKey =
      x instanceof ExamComponent ? (x.exam ? examsTab.keyOf(x.exam) : '') : x.exam_key;
    const subjectKey = x instanceof ExamComponent ? (x.subject?.code ?? '') : x.subject_key;
    return `${examKey}|${subjectKey}|${x.name}`;
  },

  diffFields(row: ExamComponentRow, existing: ExamComponent): string[] {
    const changed: string[] = [];
    if (row.exam_id !== existing.exam_id) changed.push('exam');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.name !== existing.name) changed.push('name');
    if (row.kind !== existing.kind) changed.push('kind');
    if (row.source !== existing.source) changed.push('source');
    if (String(row.full_marks) !== String(existing.full_marks)) changed.push('full_marks');
    if (String(row.pass_marks ?? '') !== String(existing.pass_marks ?? '')) {
      changed.push('pass_marks');
    }
    if (row.sequence !== existing.sequence) changed.push('sequence');
    return changed;
  },

  async upsert(
    row: ExamComponentRow,
    existing: ExamComponent | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ExamComponent> {
    const component = existing ?? new ExamComponent();
    component.tenant_id = tenantId;
    component.exam_id = row.exam_id;
    component.subject_id = row.subject_id;
    component.name = row.name;
    component.kind = row.kind as ExamComponent['kind'];
    component.source = row.source as ExamComponent['source'];
    component.full_marks = row.full_marks;
    component.pass_marks = row.pass_marks;
    component.sequence = row.sequence;

    return m.save(ExamComponent, component);
  },

  async remove(entity: ExamComponent, m: EntityManager): Promise<void> {
    await m.softRemove(ExamComponent, entity);
  },
};
