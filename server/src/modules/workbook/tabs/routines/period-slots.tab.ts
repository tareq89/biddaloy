import type { EntityManager } from 'typeorm';
import { PeriodSlot } from '../../../routines/entities/period-slot.entity';
import { Shift } from '../../../routines/entities/shift.entity';
import { PeriodSlotKind } from '@biddaloy/shared';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `period_slots` tab: one grid cell (a class period, or a `BREAK` such
 * as lunch) within a shift's day.
 *
 * `shift` is a `ref` column keyed by the shift's own `name`. `(shift,
 * sequence)` is the natural key — the same pair the DB's own unique index
 * uses.
 */

export interface PeriodSlotRow {
  id: string;
  shift_id: string;
  shift_key: string;
  sequence: number;
  kind: PeriodSlotKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'shift', type: 'ref', ref: 'shifts', required: true, label: { en: 'Shift', bn: 'শিফট' } },
  { key: 'sequence', type: 'int', required: true, label: { en: 'Sequence', bn: 'ক্রম' } },
  {
    key: 'kind',
    type: 'enum',
    enumValues: Object.values(PeriodSlotKind),
    required: true,
    label: { en: 'Kind', bn: 'ধরন' },
  },
  { key: 'name', type: 'string', label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'starts_at',
    type: 'string',
    required: true,
    label: { en: 'Starts at', bn: 'শুরু' },
  },
  { key: 'ends_at', type: 'string', required: true, label: { en: 'Ends at', bn: 'শেষ' } },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `PeriodSlot` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'shift_id', // exported instead as the `shift` ref column, keyed by the shift's own name
];

const MAX_LENGTHS: Record<string, number> = { name: 50 };

export const periodSlotsTab: TabSpec<PeriodSlot, PeriodSlotRow> = {
  name: 'period_slots',
  entity: PeriodSlot,
  excluded,
  dependsOn: ['shifts'],
  columns,
  naturalKey: ['shift', 'sequence'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<PeriodSlot[]> {
    return m.find(PeriodSlot, { where: { tenant_id: tenantId }, relations: ['shift'] });
  },

  toRow(entity: PeriodSlot, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      shift: ctx.keyOf('shifts', entity.shift_id),
      sequence: entity.sequence,
      kind: entity.kind,
      name: entity.name,
      starts_at: entity.starts_at,
      ends_at: entity.ends_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PeriodSlotRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'period_slots', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'period_slots',
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

    const shiftKey = values.shift as string;
    const shiftId = ctx.ref('shifts', shiftKey);
    if (!shiftId) {
      errors.push({
        tab: 'period_slots',
        row: rowNo,
        column: 'shift',
        message: `Column "shift": no shift named "${shiftKey}" was found.`,
        severity: 'error',
        value: shiftKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        shift_id: shiftId as string,
        shift_key: shiftKey,
        sequence: values.sequence as number,
        kind: values.kind as PeriodSlotKind,
        name: (values.name as string | null) ?? null,
        starts_at: values.starts_at as string,
        ends_at: values.ends_at as string,
      },
    };
  },

  keyOf(x: PeriodSlotRow | PeriodSlot): string {
    const shiftKey = x instanceof PeriodSlot ? (x.shift?.name ?? '') : x.shift_key;
    return `${shiftKey}|${x.sequence}`;
  },

  diffFields(row: PeriodSlotRow, existing: PeriodSlot): string[] {
    const changed: string[] = [];
    if (row.shift_id !== existing.shift_id) changed.push('shift');
    if (row.sequence !== existing.sequence) changed.push('sequence');
    if (row.kind !== existing.kind) changed.push('kind');
    if (row.name !== existing.name) changed.push('name');
    if (row.starts_at !== existing.starts_at) changed.push('starts_at');
    if (row.ends_at !== existing.ends_at) changed.push('ends_at');
    return changed;
  },

  async upsert(
    row: PeriodSlotRow,
    existing: PeriodSlot | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<PeriodSlot> {
    const slot = existing ?? new PeriodSlot();
    slot.tenant_id = tenantId;
    slot.shift_id = row.shift_id;
    slot.sequence = row.sequence;
    slot.kind = row.kind;
    slot.name = row.name;
    slot.starts_at = row.starts_at;
    slot.ends_at = row.ends_at;

    return m.save(PeriodSlot, slot);
  },

  async remove(entity: PeriodSlot, m: EntityManager): Promise<void> {
    // No independent soft-delete lifecycle (see PeriodSlot's docstring) —
    // a period removed on restore is deleted outright.
    await m.remove(PeriodSlot, entity);
  },
};
