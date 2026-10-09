import type { EntityManager } from 'typeorm';
import { Shift } from '../../../routines/entities/shift.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `shifts` tab: a tenant's named daily shifts (e.g. "Morning", "Day").
 *
 * No `ref` columns — a shift depends only on the tenant. `day_starts_at`/
 * `day_ends_at` are Postgres `time` columns (`'08:00:00'` strings), exported
 * as plain `string` cells since the codec has no dedicated `time` type.
 */

export interface ShiftRow {
  id: string;
  name: string;
  day_starts_at: string;
  day_ends_at: string;
  sequence: number;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'day_starts_at',
    type: 'string',
    required: true,
    label: { en: 'Day starts at', bn: 'দিন শুরু' },
  },
  {
    key: 'day_ends_at',
    type: 'string',
    required: true,
    label: { en: 'Day ends at', bn: 'দিন শেষ' },
  },
  { key: 'sequence', type: 'int', required: true, label: { en: 'Sequence', bn: 'ক্রম' } },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Shift` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [];

const MAX_LENGTHS: Record<string, number> = { name: 100 };

export const shiftsTab: TabSpec<Shift, ShiftRow> = {
  name: 'shifts',
  entity: Shift,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Shift[]> {
    return m.find(Shift, { where: { tenant_id: tenantId } });
  },

  toRow(entity: Shift, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      day_starts_at: entity.day_starts_at,
      day_ends_at: entity.day_ends_at,
      sequence: entity.sequence,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: ShiftRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'shifts', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'shifts',
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
        day_starts_at: values.day_starts_at as string,
        day_ends_at: values.day_ends_at as string,
        sequence: values.sequence as number,
      },
    };
  },

  keyOf(x: ShiftRow | Shift): string {
    return x.name;
  },

  diffFields(row: ShiftRow, existing: Shift): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.day_starts_at !== existing.day_starts_at) changed.push('day_starts_at');
    if (row.day_ends_at !== existing.day_ends_at) changed.push('day_ends_at');
    if (row.sequence !== existing.sequence) changed.push('sequence');
    return changed;
  },

  async upsert(
    row: ShiftRow,
    existing: Shift | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Shift> {
    const shift = existing ?? new Shift();
    shift.tenant_id = tenantId;
    shift.name = row.name;
    shift.day_starts_at = row.day_starts_at;
    shift.day_ends_at = row.day_ends_at;
    shift.sequence = row.sequence;

    return m.save(Shift, shift);
  },

  async remove(entity: Shift, m: EntityManager): Promise<void> {
    await m.softRemove(Shift, entity);
  },
};
