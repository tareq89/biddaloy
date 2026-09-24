import type { EntityManager } from 'typeorm';
import { Room } from '../../../routines/entities/room.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `rooms` tab: physical rooms a class can be scheduled into.
 *
 * `(building, room_no)` is the natural key, matching the DB's own
 * `NULLS NOT DISTINCT` unique index (see `Room`'s docstring) — a missing
 * `building` normalises to `''` here so two such rooms still collide on
 * the same key rather than diverging on `null` vs `undefined`.
 */

export interface RoomRow {
  id: string;
  building: string | null;
  room_no: string;
  capacity: number | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'building', type: 'string', label: { en: 'Building', bn: 'ভবন' } },
  { key: 'room_no', type: 'string', required: true, label: { en: 'Room no.', bn: 'কক্ষ নং' } },
  { key: 'capacity', type: 'int', label: { en: 'Capacity', bn: 'ধারণক্ষমতা' } },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Room` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [];

const MAX_LENGTHS: Record<string, number> = { building: 100, room_no: 50 };

export const roomsTab: TabSpec<Room, RoomRow> = {
  name: 'rooms',
  entity: Room,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['building', 'room_no'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Room[]> {
    return m.find(Room, { where: { tenant_id: tenantId } });
  },

  toRow(entity: Room, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      building: entity.building,
      room_no: entity.room_no,
      capacity: entity.capacity,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: RoomRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'rooms', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'rooms',
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
        building: (values.building as string | null) ?? null,
        room_no: values.room_no as string,
        capacity: (values.capacity as number | null) ?? null,
      },
    };
  },

  keyOf(x: RoomRow | Room): string {
    return `${x.building ?? ''}|${x.room_no}`;
  },

  diffFields(row: RoomRow, existing: Room): string[] {
    const changed: string[] = [];
    if (row.building !== existing.building) changed.push('building');
    if (row.room_no !== existing.room_no) changed.push('room_no');
    if (row.capacity !== existing.capacity) changed.push('capacity');
    return changed;
  },

  async upsert(
    row: RoomRow,
    existing: Room | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Room> {
    const room = existing ?? new Room();
    room.tenant_id = tenantId;
    room.building = row.building;
    room.room_no = row.room_no;
    room.capacity = row.capacity;

    return m.save(Room, room);
  },

  async remove(entity: Room, m: EntityManager): Promise<void> {
    await m.softRemove(Room, entity);
  },
};
