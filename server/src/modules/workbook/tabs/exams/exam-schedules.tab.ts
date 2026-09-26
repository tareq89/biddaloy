import type { EntityManager } from 'typeorm';
import { ExamSchedule } from '../../../exams/entities/exam-schedule.entity';
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
 * The `exam_schedules` tab: one subject's sitting within one exam — date,
 * start/end time, optional venue — `ExamSchedule` (19.11.1). No `time`
 * `ColumnType` exists in this codec, so `starts_at`/`ends_at` export as
 * plain `string` cells (`"09:00:00"`); the DB's `time` column type still
 * validates the value on import.
 */

export interface ExamScheduleRow {
  id: string;
  exam_id: string;
  exam_key: string;
  subject_id: string;
  subject_key: string;
  date: string;
  starts_at: string;
  ends_at: string;
  venue: string | null;
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
  { key: 'date', type: 'date', required: true, label: { en: 'Date', bn: 'তারিখ' } },
  { key: 'starts_at', type: 'string', required: true, label: { en: 'Starts at', bn: 'শুরু' } },
  { key: 'ends_at', type: 'string', required: true, label: { en: 'Ends at', bn: 'শেষ' } },
  { key: 'venue', type: 'string', label: { en: 'Venue', bn: 'স্থান' } },
];

const excluded: readonly string[] = [
  'exam_id', // exported instead as the `exam` ref column
  'subject_id', // exported instead as the `subject` ref column
  'room_id', // [25.1] derived from `venue` by the seat-plans migration backfill; not a workbook-editable column yet
];

const MAX_LENGTHS: Record<string, number> = {
  venue: 200,
};

export const examSchedulesTab: TabSpec<ExamSchedule, ExamScheduleRow> = {
  name: 'exam_schedules',
  entity: ExamSchedule,
  excluded,
  dependsOn: ['exams', 'subjects'],
  columns,
  naturalKey: ['exam', 'subject'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ExamSchedule[]> {
    return m.find(ExamSchedule, {
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

  toRow(entity: ExamSchedule, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      exam: ctx.keyOf('exams', entity.exam_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      date: entity.date,
      starts_at: entity.starts_at,
      ends_at: entity.ends_at,
      venue: entity.venue,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ExamScheduleRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'exam_schedules', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'exam_schedules',
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
          tab: 'exam_schedules',
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
          tab: 'exam_schedules',
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
        date: values.date as string,
        starts_at: values.starts_at as string,
        ends_at: values.ends_at as string,
        venue: (values.venue as string | null) ?? null,
      },
    };
  },

  keyOf(x: ExamScheduleRow | ExamSchedule): string {
    const examKey = x instanceof ExamSchedule ? (x.exam ? examsTab.keyOf(x.exam) : '') : x.exam_key;
    const subjectKey = x instanceof ExamSchedule ? (x.subject?.code ?? '') : x.subject_key;
    return `${examKey}|${subjectKey}`;
  },

  diffFields(row: ExamScheduleRow, existing: ExamSchedule): string[] {
    const changed: string[] = [];
    if (row.exam_id !== existing.exam_id) changed.push('exam');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.date !== existing.date) changed.push('date');
    if (row.starts_at !== existing.starts_at) changed.push('starts_at');
    if (row.ends_at !== existing.ends_at) changed.push('ends_at');
    if ((row.venue ?? '') !== (existing.venue ?? '')) changed.push('venue');
    return changed;
  },

  async upsert(
    row: ExamScheduleRow,
    existing: ExamSchedule | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ExamSchedule> {
    const schedule = existing ?? new ExamSchedule();
    schedule.tenant_id = tenantId;
    schedule.exam_id = row.exam_id;
    schedule.subject_id = row.subject_id;
    schedule.date = row.date;
    schedule.starts_at = row.starts_at;
    schedule.ends_at = row.ends_at;
    schedule.venue = row.venue;

    return m.save(ExamSchedule, schedule);
  },

  async remove(entity: ExamSchedule, m: EntityManager): Promise<void> {
    await m.softRemove(ExamSchedule, entity);
  },
};
