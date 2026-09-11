import type { EntityManager } from 'typeorm';
import { Subject } from '../../../academics/entities/subject.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `subjects` tab: subjects a school teaches (e.g. "Mathematics").
 *
 * No `ref` columns: `code` is the natural key, unique per tenant, and is
 * what `class_subjects` resolves against.
 */

export interface SubjectRow {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'code', type: 'string', required: true, label: { en: 'Code', bn: 'কোড' } },
  {
    key: 'name_en',
    type: 'string',
    required: true,
    label: { en: 'Name (English)', bn: 'নাম (ইংরেজি)' },
  },
  { key: 'name_bn', type: 'string', label: { en: 'Name (Bangla)', bn: 'নাম (বাংলা)' } },
  {
    key: 'is_active',
    type: 'bool',
    required: true,
    label: { en: 'Is active', bn: 'সক্রিয় কিনা' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Subject` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [];

const MAX_LENGTHS: Record<string, number> = {
  code: 20,
  name_en: 100,
  name_bn: 100,
};

export const subjectsTab: TabSpec<Subject, SubjectRow> = {
  name: 'subjects',
  entity: Subject,
  excluded,
  dependsOn: ['school'],
  columns,
  naturalKey: ['code'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Subject[]> {
    return m.find(Subject, { where: { tenant_id: tenantId } });
  },

  toRow(entity: Subject, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      code: entity.code,
      name_en: entity.name_en,
      name_bn: entity.name_bn,
      is_active: entity.is_active,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: SubjectRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'subjects', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'subjects',
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
        code: values.code as string,
        name_en: values.name_en as string,
        name_bn: (values.name_bn as string | null) ?? null,
        is_active: values.is_active as boolean,
      },
    };
  },

  keyOf(x: SubjectRow | Subject): string {
    return x.code;
  },

  diffFields(row: SubjectRow, existing: Subject): string[] {
    const changed: string[] = [];
    if (row.code !== existing.code) changed.push('code');
    if (row.name_en !== existing.name_en) changed.push('name_en');
    if (row.name_bn !== existing.name_bn) changed.push('name_bn');
    if (row.is_active !== existing.is_active) changed.push('is_active');
    return changed;
  },

  async upsert(
    row: SubjectRow,
    existing: Subject | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Subject> {
    const subject = existing ?? new Subject();
    subject.tenant_id = tenantId;
    subject.code = row.code;
    subject.name_en = row.name_en;
    subject.name_bn = row.name_bn;
    subject.is_active = row.is_active;

    return m.save(Subject, subject);
  },

  async remove(entity: Subject, m: EntityManager): Promise<void> {
    await m.softRemove(Subject, entity);
  },
};
