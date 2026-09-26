import type { EntityManager } from 'typeorm';
import { SeatPlan } from '../../../seat-plans/entities/seat-plan.entity';
import { SeatPlanStatus, SeatOrderMode } from '@biddaloy/shared';
import { fromCell, formatDateTime } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `seat_plans` tab: a named grouping of exam schedules whose students
 * get seat allocations together (25.1.1's `SeatPlan`).
 *
 * `name` is this tab's `naturalKey`, but unlike `invoices.tab.ts`'s
 * `invoice_number` it is not backed by a DB unique index — two plans can
 * legitimately share a name (e.g. "Midterm Seating" reused each term). A
 * workbook round-trip therefore only distinguishes plans by name; two
 * same-named plans in one tenant collapse to one row on export/import, same
 * risk `homework.tab.ts` accepts for `title`. No better tenant-visible
 * identity exists on this entity to key off instead.
 */

export interface SeatPlanRow {
  id: string;
  name: string;
  status: SeatPlanStatus;
  seat_order_mode: SeatOrderMode;
  published_at: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'status',
    type: 'enum',
    enumValues: Object.values(SeatPlanStatus),
    required: true,
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  {
    key: 'seat_order_mode',
    type: 'enum',
    enumValues: Object.values(SeatOrderMode),
    required: true,
    label: { en: 'Seat order mode', bn: 'সিট ক্রম' },
  },
  {
    key: 'published_at',
    type: 'datetime',
    label: { en: 'Published at', bn: 'প্রকাশের সময়' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `SeatPlan` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [];

const MAX_LENGTHS: Record<string, number> = {
  name: 200,
};

export const seatPlansTab: TabSpec<SeatPlan, SeatPlanRow> = {
  name: 'seat_plans',
  entity: SeatPlan,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<SeatPlan[]> {
    return m.find(SeatPlan, { where: { tenant_id: tenantId } });
  },

  toRow(entity: SeatPlan, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      status: entity.status,
      seat_order_mode: entity.seat_order_mode,
      published_at: entity.published_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: SeatPlanRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'seat_plans', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'seat_plans',
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
        status: values.status as SeatPlanStatus,
        seat_order_mode: values.seat_order_mode as SeatOrderMode,
        published_at: (values.published_at as string | null) ?? null,
      },
    };
  },

  keyOf(x: SeatPlanRow | SeatPlan): string {
    return x.name;
  },

  diffFields(row: SeatPlanRow, existing: SeatPlan): string[] {
    const changed: string[] = [];
    if (row.status !== existing.status) changed.push('status');
    if (row.seat_order_mode !== existing.seat_order_mode) changed.push('seat_order_mode');
    const existingPublishedAt = existing.published_at
      ? formatDateTime(existing.published_at)
      : null;
    if (row.published_at !== existingPublishedAt) changed.push('published_at');
    return changed;
  },

  async upsert(
    row: SeatPlanRow,
    existing: SeatPlan | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<SeatPlan> {
    const plan = existing ?? new SeatPlan();
    plan.tenant_id = tenantId;
    plan.name = row.name;
    plan.status = row.status;
    plan.seat_order_mode = row.seat_order_mode;
    plan.published_at = row.published_at ? new Date(row.published_at) : null;

    return m.save(SeatPlan, plan);
  },

  async remove(entity: SeatPlan, m: EntityManager): Promise<void> {
    await m.softRemove(SeatPlan, entity);
  },
};
