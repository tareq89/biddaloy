import type { EntityManager } from 'typeorm';
import { RoutineChangeRequest } from '../../../routines/entities/routine-change-request.entity';
import { ChangeRequestState } from '@biddaloy/shared';
import { fromCell, formatDateTime } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { routineSlotsTab } from './routine-slots.tab';

/**
 * The `routine_change_requests` tab: a request to change a *published*
 * `RoutineSlot`, tracked separately so it can be accepted or rejected
 * without silently mutating the live timetable.
 *
 * `resolved_by`/`resolved_at`/`resolution_note` are all `null` together
 * while `state = 'OPEN'`. No single column is unique enough to be the
 * natural key alone, so `(routine_slot, requested_by, note)` is used —
 * good enough for a workbook restore; two identical open requests from
 * the same user for the same slot would collide, which is an acceptable
 * edge case for this ticket's scope.
 */

export interface RoutineChangeRequestRow {
  id: string;
  routine_slot_id: string;
  routine_slot_key: string;
  requested_by: string;
  requested_by_key: string;
  note: string;
  state: ChangeRequestState;
  resolved_by: string | null;
  resolved_by_key: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'routine_slot',
    type: 'ref',
    ref: 'routine_slots',
    required: true,
    label: { en: 'Routine slot', bn: 'রুটিন স্লট' },
  },
  {
    key: 'requested_by',
    type: 'ref',
    ref: 'users',
    required: true,
    label: { en: 'Requested by', bn: 'অনুরোধকারী' },
  },
  { key: 'note', type: 'string', required: true, label: { en: 'Note', bn: 'নোট' } },
  {
    key: 'state',
    type: 'enum',
    enumValues: Object.values(ChangeRequestState),
    required: true,
    label: { en: 'State', bn: 'অবস্থা' },
  },
  { key: 'resolved_by', type: 'ref', ref: 'users', label: { en: 'Resolved by', bn: 'সমাধানকারী' } },
  { key: 'resolved_at', type: 'datetime', label: { en: 'Resolved at', bn: 'সমাধানের সময়' } },
  {
    key: 'resolution_note',
    type: 'string',
    label: { en: 'Resolution note', bn: 'সমাধান নোট' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new
 * `RoutineChangeRequest` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'routine_slot_id', // exported instead as the `routine_slot` ref column
];

const MAX_LENGTHS: Record<string, number> = { note: 500, resolution_note: 500 };

export const routineChangeRequestsTab: TabSpec<RoutineChangeRequest, RoutineChangeRequestRow> = {
  name: 'routine_change_requests',
  entity: RoutineChangeRequest,
  excluded,
  dependsOn: ['routine_slots', 'users'],
  columns,
  naturalKey: ['routine_slot', 'requested_by', 'note'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<RoutineChangeRequest[]> {
    return m.find(RoutineChangeRequest, {
      where: { tenant_id: tenantId },
      relations: [
        'routine_slot',
        'routine_slot.routine',
        'routine_slot.routine.academic_year',
        'routine_slot.section',
        'routine_slot.section.class',
        'routine_slot.section.class.academic_year',
        'routine_slot.period_slot',
        'routine_slot.period_slot.shift',
        'requested_by_user',
        'resolved_by_user',
      ],
    });
  },

  toRow(entity: RoutineChangeRequest, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      routine_slot: ctx.keyOf('routine_slots', entity.routine_slot_id),
      requested_by: ctx.keyOf('users', entity.requested_by),
      note: entity.note,
      state: entity.state,
      resolved_by: entity.resolved_by ? ctx.keyOf('users', entity.resolved_by) : null,
      resolved_at: entity.resolved_at,
      resolution_note: entity.resolution_note,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: RoutineChangeRequestRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'routine_change_requests', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'routine_change_requests',
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

    const routineSlotKey = values.routine_slot as string;
    const routineSlotId = ctx.ref('routine_slots', routineSlotKey);
    if (!routineSlotId) {
      errors.push({
        tab: 'routine_change_requests',
        row: rowNo,
        column: 'routine_slot',
        message: `Column "routine_slot": no routine slot named "${routineSlotKey}" was found.`,
        severity: 'error',
        value: routineSlotKey,
      });
    }

    const requestedByKey = values.requested_by as string;
    const requestedById = ctx.ref('users', requestedByKey);
    if (!requestedById) {
      errors.push({
        tab: 'routine_change_requests',
        row: rowNo,
        column: 'requested_by',
        message: `Column "requested_by": no user "${requestedByKey}" was found.`,
        severity: 'error',
        value: requestedByKey,
      });
    }

    const resolvedByKey = (values.resolved_by as string | null) ?? null;
    let resolvedById: string | null = null;
    if (resolvedByKey) {
      resolvedById = ctx.ref('users', resolvedByKey) ?? null;
      if (!resolvedById) {
        errors.push({
          tab: 'routine_change_requests',
          row: rowNo,
          column: 'resolved_by',
          message: `Column "resolved_by": no user "${resolvedByKey}" was found.`,
          severity: 'error',
          value: resolvedByKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        routine_slot_id: routineSlotId as string,
        routine_slot_key: routineSlotKey,
        requested_by: requestedById as string,
        requested_by_key: requestedByKey,
        note: values.note as string,
        state: values.state as ChangeRequestState,
        resolved_by: resolvedById,
        resolved_by_key: resolvedByKey,
        resolved_at: (values.resolved_at as string | null) ?? null,
        resolution_note: (values.resolution_note as string | null) ?? null,
      },
    };
  },

  keyOf(x: RoutineChangeRequestRow | RoutineChangeRequest): string {
    if (x instanceof RoutineChangeRequest) {
      const slotKey = x.routine_slot ? routineSlotsTab.keyOf(x.routine_slot) : '';
      const requestedByKey =
        x.requested_by_user?.email?.trim() || x.requested_by_user?.phone?.trim() || '';
      return `${slotKey}|${requestedByKey}|${x.note}`;
    }
    return `${x.routine_slot_key}|${x.requested_by_key}|${x.note}`;
  },

  diffFields(row: RoutineChangeRequestRow, existing: RoutineChangeRequest): string[] {
    const changed: string[] = [];
    if (row.routine_slot_id !== existing.routine_slot_id) changed.push('routine_slot');
    if (row.requested_by !== existing.requested_by) changed.push('requested_by');
    if (row.note !== existing.note) changed.push('note');
    if (row.state !== existing.state) changed.push('state');
    if (row.resolved_by !== existing.resolved_by) changed.push('resolved_by');
    const existingResolvedAt = existing.resolved_at ? formatDateTime(existing.resolved_at) : null;
    if (row.resolved_at !== existingResolvedAt) changed.push('resolved_at');
    if (row.resolution_note !== existing.resolution_note) changed.push('resolution_note');
    return changed;
  },

  async upsert(
    row: RoutineChangeRequestRow,
    existing: RoutineChangeRequest | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<RoutineChangeRequest> {
    const request = existing ?? new RoutineChangeRequest();
    request.tenant_id = tenantId;
    request.routine_slot_id = row.routine_slot_id;
    request.requested_by = row.requested_by;
    request.note = row.note;
    request.state = row.state;
    request.resolved_by = row.resolved_by;
    request.resolved_at = row.resolved_at ? new Date(row.resolved_at) : null;
    request.resolution_note = row.resolution_note;

    return m.save(RoutineChangeRequest, request);
  },

  async remove(entity: RoutineChangeRequest, m: EntityManager): Promise<void> {
    await m.remove(RoutineChangeRequest, entity);
  },
};
