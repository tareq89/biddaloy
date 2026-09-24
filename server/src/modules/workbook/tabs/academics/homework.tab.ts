import type { EntityManager } from 'typeorm';
import { HomeworkGradingMode } from '@biddaloy/shared';
import { Homework } from '../../../homework/entities/homework.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { classesTab } from './classes.tab';
import { subjectsTab } from './subjects.tab';

/**
 * The `homework` tab (Epic 22.0, [22.3.6]). `attachments` is exported as
 * `json` rather than a dedicated column type — same treatment as any other
 * jsonb blob this codec doesn't otherwise model.
 */
export interface HomeworkRow {
  id: string;
  title: string;
  description: string | null;
  subject_id: string;
  class_id: string;
  grading_mode: HomeworkGradingMode;
  attachments: unknown[];
  class_key: string;
  subject_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'title', type: 'string', required: true, label: { en: 'Title', bn: 'শিরোনাম' } },
  { key: 'description', type: 'string', label: { en: 'Description', bn: 'বিবরণ' } },
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    required: true,
    label: { en: 'Class', bn: 'শ্রেণী' },
  },
  {
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  {
    key: 'grading_mode',
    type: 'enum',
    required: true,
    enumValues: Object.values(HomeworkGradingMode),
    label: { en: 'Grading mode', bn: 'গ্রেডিং মোড' },
  },
  { key: 'attachments', type: 'json', label: { en: 'Attachments', bn: 'সংযুক্তি' } },
];

const excluded: readonly string[] = [
  'subject_id', // exported instead as the `subject` ref column, keyed by the subject's `code`
  'class_id', // exported instead as the `class` ref column, keyed by the referenced tab's natural key
];

export const homeworkTab: TabSpec<Homework, HomeworkRow> = {
  name: 'homework',
  entity: Homework,
  excluded,
  dependsOn: ['classes', 'subjects'],
  columns,
  naturalKey: ['class', 'subject', 'title'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Homework[]> {
    return m.find(Homework, {
      where: { tenant_id: tenantId },
      // `klass.academic_year` must be eager-loaded too — `keyOf` calls
      // `classesTab.keyOf(x.klass)`, which reads `klass.academic_year?.name`
      // (see classes.tab.ts). Without the nested relation that comes back
      // undefined and the natural key silently drops the year segment,
      // breaking cross-references from homework_assignments/submissions.
      relations: ['klass', 'klass.academic_year', 'subject'],
    });
  },

  toRow(entity: Homework, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      title: entity.title,
      description: entity.description,
      class: ctx.keyOf('classes', entity.class_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      grading_mode: entity.grading_mode,
      attachments: entity.attachments ?? [],
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: HomeworkRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'homework', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const classKey = values.class as string;
    const classId = ctx.ref('classes', classKey);
    if (!classId) {
      errors.push({
        tab: 'homework',
        row: rowNo,
        column: 'class',
        message: `Column "class": no class named "${classKey}" was found.`,
        severity: 'error',
        value: classKey,
      });
    }

    const subjectKey = values.subject as string;
    const subjectId = ctx.ref('subjects', subjectKey);
    if (!subjectId) {
      errors.push({
        tab: 'homework',
        row: rowNo,
        column: 'subject',
        message: `Column "subject": no subject with code "${subjectKey}" was found.`,
        severity: 'error',
        value: subjectKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        title: values.title as string,
        description: (values.description as string | null) ?? null,
        subject_id: subjectId as string,
        class_id: classId as string,
        grading_mode: values.grading_mode as HomeworkGradingMode,
        attachments: (values.attachments as unknown[] | null) ?? [],
        class_key: classKey,
        subject_key: subjectKey,
      },
    };
  },

  keyOf(x: HomeworkRow | Homework): string {
    const classKey =
      x instanceof Homework ? (x.klass ? classesTab.keyOf(x.klass) : '') : x.class_key;
    const subjectKey =
      x instanceof Homework ? (x.subject ? subjectsTab.keyOf(x.subject) : '') : x.subject_key;
    return `${classKey}|${subjectKey}|${x.title}`;
  },

  diffFields(row: HomeworkRow, existing: Homework): string[] {
    const changed: string[] = [];
    if (row.title !== existing.title) changed.push('title');
    if (row.description !== existing.description) changed.push('description');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.grading_mode !== existing.grading_mode) changed.push('grading_mode');
    return changed;
  },

  async upsert(
    row: HomeworkRow,
    existing: Homework | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Homework> {
    const homework = existing ?? new Homework();
    homework.tenant_id = tenantId;
    homework.title = row.title;
    homework.description = row.description;
    homework.subject_id = row.subject_id;
    homework.class_id = row.class_id;
    homework.grading_mode = row.grading_mode;
    homework.attachments = row.attachments;
    return m.save(Homework, homework);
  },

  async remove(entity: Homework, m: EntityManager): Promise<void> {
    // `Homework` has no `deleted_at` column — hard delete, same as
    // `TeacherClassSection`.
    await m.remove(Homework, entity);
  },
};
