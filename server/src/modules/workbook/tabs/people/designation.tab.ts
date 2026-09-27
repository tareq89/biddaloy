import type { EntityManager } from 'typeorm';
import { Designation } from '../../../staff-hr/entities/designation.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `designations` tab (23.5): a tenant-editable job title. No FK to
 * another tab — `title_en` is unique per tenant (`designation.entity.ts`)
 * and is the natural key.
 */
export interface DesignationRow {
  id: string;
  title_en: string;
  title_bn: string | null;
  is_teaching: boolean;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'title_en', type: 'string', required: true, label: { en: 'Title (EN)', bn: 'পদবি (ইংরেজি)' } },
  { key: 'title_bn', type: 'string', label: { en: 'Title (BN)', bn: 'পদবি (বাংলা)' } },
  { key: 'is_teaching', type: 'bool', label: { en: 'Is teaching', bn: 'শিক্ষণ পদ' } },
];

export const designationTab: TabSpec<Designation, DesignationRow> = {
  name: 'designations',
  entity: Designation,
  excluded: [],
  dependsOn: [],
  columns,
  naturalKey: ['title_en'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Designation[]> {
    return m.find(Designation, { where: { tenant_id: tenantId } });
  },

  toRow(entity: Designation): Record<string, unknown> {
    return {
      id: entity.id,
      title_en: entity.title_en,
      title_bn: entity.title_bn,
      is_teaching: entity.is_teaching,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: DesignationRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'designations', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        title_en: values.title_en as string,
        title_bn: (values.title_bn as string | null) ?? null,
        is_teaching: (values.is_teaching as boolean | null) ?? false,
      },
    };
  },

  keyOf(x: DesignationRow | Designation): string {
    return x.title_en?.trim() ?? '';
  },

  diffFields(row: DesignationRow, existing: Designation): string[] {
    const changed: string[] = [];
    if (row.title_bn !== existing.title_bn) changed.push('title_bn');
    if (row.is_teaching !== existing.is_teaching) changed.push('is_teaching');
    return changed;
  },

  async upsert(
    row: DesignationRow,
    existing: Designation | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Designation> {
    const designation = existing ?? new Designation();
    designation.tenant_id = tenantId;
    designation.title_en = row.title_en;
    designation.title_bn = row.title_bn;
    designation.is_teaching = row.is_teaching;
    return m.save(Designation, designation);
  },

  async remove(entity: Designation, m: EntityManager): Promise<void> {
    await m.softRemove(Designation, entity);
  },
};
