import type { EntityManager } from 'typeorm';
import { SyllabusTopicStatus } from '@biddaloy/shared';
import { SyllabusTopic } from '../../../homework/entities/syllabus-topic.entity';
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
 * The `syllabus_topics` tab (Epic 22.0, [22.3.6]): one row per topic,
 * ordered by `sequence` within a class/subject (D19).
 */
export interface SyllabusTopicRow {
  id: string;
  class_id: string;
  subject_id: string;
  name: string;
  description: string | null;
  sequence: number;
  status: SyllabusTopicStatus;
  class_key: string;
  subject_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
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
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  { key: 'description', type: 'string', label: { en: 'Description', bn: 'বিবরণ' } },
  { key: 'sequence', type: 'int', required: true, label: { en: 'Sequence', bn: 'ক্রম' } },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(SyllabusTopicStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
];

const excluded: readonly string[] = [
  'class_id', // exported instead as the `class` ref column, keyed by the referenced tab's natural key
  'subject_id', // exported instead as the `subject` ref column, keyed by the subject's `code`
];

export const syllabusTopicTab: TabSpec<SyllabusTopic, SyllabusTopicRow> = {
  name: 'syllabus_topics',
  entity: SyllabusTopic,
  excluded,
  dependsOn: ['classes', 'subjects'],
  columns,
  naturalKey: ['class', 'subject', 'sequence'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<SyllabusTopic[]> {
    return m.find(SyllabusTopic, {
      where: { tenant_id: tenantId },
      // `klass.academic_year` required: `keyOf` calls
      // `classesTab.keyOf(x.klass)`, which reads `klass.academic_year?.name`.
      relations: ['klass', 'klass.academic_year', 'subject'],
    });
  },

  toRow(entity: SyllabusTopic, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      class: ctx.keyOf('classes', entity.class_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      name: entity.name,
      description: entity.description,
      sequence: entity.sequence,
      status: entity.status,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: SyllabusTopicRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'syllabus_topics', rowNo);
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
        tab: 'syllabus_topics',
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
        tab: 'syllabus_topics',
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
        class_id: classId as string,
        subject_id: subjectId as string,
        name: values.name as string,
        description: (values.description as string | null) ?? null,
        sequence: values.sequence as number,
        status: values.status as SyllabusTopicStatus,
        class_key: classKey,
        subject_key: subjectKey,
      },
    };
  },

  keyOf(x: SyllabusTopicRow | SyllabusTopic): string {
    const classKey =
      x instanceof SyllabusTopic ? (x.klass ? classesTab.keyOf(x.klass) : '') : x.class_key;
    const subjectKey =
      x instanceof SyllabusTopic ? (x.subject ? subjectsTab.keyOf(x.subject) : '') : x.subject_key;
    return `${classKey}|${subjectKey}|${x.sequence}`;
  },

  diffFields(row: SyllabusTopicRow, existing: SyllabusTopic): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.description !== existing.description) changed.push('description');
    if (row.status !== existing.status) changed.push('status');
    return changed;
  },

  async upsert(
    row: SyllabusTopicRow,
    existing: SyllabusTopic | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<SyllabusTopic> {
    const topic = existing ?? new SyllabusTopic();
    topic.tenant_id = tenantId;
    topic.class_id = row.class_id;
    topic.subject_id = row.subject_id;
    topic.name = row.name;
    topic.description = row.description;
    topic.sequence = row.sequence;
    topic.status = row.status;
    return m.save(SyllabusTopic, topic);
  },

  async remove(entity: SyllabusTopic, m: EntityManager): Promise<void> {
    await m.remove(SyllabusTopic, entity);
  },
};
