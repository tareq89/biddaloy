import type { EntityManager } from 'typeorm';
import { ExamTemplate } from '../../../exams/entities/exam-template.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `exam_templates` tab: a reusable exam shape ([35.1.3]). Natural key is
 * `name` (the entity's unique index is tenant + name among live rows). Its
 * component lines live in `exam_template_components`.
 */

export interface ExamTemplateRow {
  id: string;
  name: string;
  kind: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'kind',
    type: 'enum',
    enumValues: ['TERM', 'MONTHLY', 'MODEL', 'OTHER'],
    required: true,
    label: { en: 'Kind', bn: 'ধরন' },
  },
];

const excluded: readonly string[] = [
  'tenant_id', // always the destination tenant
  'created_at', // system timestamps
  'updated_at',
  'deleted_at', // soft-delete marker; deleted templates are not backed up
];

const MAX_LENGTHS: Record<string, number> = { name: 200 };

export const examTemplatesTab: TabSpec<ExamTemplate, ExamTemplateRow> = {
  name: 'exam_templates',
  entity: ExamTemplate,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ExamTemplate[]> {
    return m.find(ExamTemplate, { where: { tenant_id: tenantId } });
  },

  toRow(entity: ExamTemplate, _ctx: ExportContext): Record<string, unknown> {
    return { id: entity.id, name: entity.name, kind: entity.kind };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: ExamTemplateRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'exam_templates', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'exam_templates',
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

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        kind: values.kind as string,
      },
    };
  },

  keyOf(x: ExamTemplateRow | ExamTemplate): string {
    return x.name;
  },

  diffFields(row: ExamTemplateRow, existing: ExamTemplate): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.kind !== existing.kind) changed.push('kind');
    return changed;
  },

  async upsert(
    row: ExamTemplateRow,
    existing: ExamTemplate | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ExamTemplate> {
    const template = existing ?? new ExamTemplate();
    template.tenant_id = tenantId;
    template.name = row.name;
    template.kind = row.kind as ExamTemplate['kind'];
    // `components` (tenant-filtered-by-parent OneToMany) is never loaded or
    // assigned here, so this save cannot orphan any child row.
    return m.save(ExamTemplate, template);
  },

  async remove(entity: ExamTemplate, m: EntityManager): Promise<void> {
    await m.softRemove(ExamTemplate, entity);
  },
};
