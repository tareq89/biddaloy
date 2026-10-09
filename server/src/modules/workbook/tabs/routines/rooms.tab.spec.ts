import { describe, expect, it } from 'vitest';
import { Room } from '../../../routines/entities/room.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { roomsTab, type RoomRow } from './rooms.tab';

const ROOM_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = { keyOf: () => '' };
function makeImportCtx(): ImportContext {
  return { tenantId: TENANT_ID, ref: () => undefined, warn: () => undefined };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return Object.assign(new Room(), {
    id: ROOM_ID,
    building: 'Building A',
    room_no: '204',
    capacity: 40,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Room>);
}

function toCells(room: Room): Record<string, string> {
  const row = roomsTab.toRow(room, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of roomsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('roomsTab shape', () => {
  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([roomsTab], { partial: true })).not.toThrow();
  });

  it('has no dependencies, deletes by absence', () => {
    expect(roomsTab.name).toBe('rooms');
    expect(roomsTab.dependsOn).toEqual([]);
    expect(roomsTab.naturalKey).toEqual(['building', 'room_no']);
    expect(roomsTab.deleteByAbsence).toBe(true);
  });

  it('keys two rooms with no building distinctly by room_no', () => {
    const a = makeRoom({ building: null, room_no: '101' });
    const b = makeRoom({ building: null, room_no: '102' });
    expect(roomsTab.keyOf(a)).not.toBe(roomsTab.keyOf(b));
  });
});

describe('round trip', () => {
  it('round-trips a room', () => {
    const room = makeRoom();
    const result = roomsTab.fromRow(toCells(room), 2, makeImportCtx());

    expect(result).toEqual({
      row: { id: ROOM_ID, building: 'Building A', room_no: '204', capacity: 40 } satisfies RoomRow,
    });
  });

  it('round-trips a room with no building', () => {
    const room = makeRoom({ building: null, capacity: null });
    const result = roomsTab.fromRow(toCells(room), 2, makeImportCtx());

    expect(result).toEqual({
      row: { id: ROOM_ID, building: null, room_no: '204', capacity: null } satisfies RoomRow,
    });
  });
});

describe('diffFields', () => {
  it('reports a changed capacity', () => {
    const room = makeRoom();
    const row: RoomRow = { id: ROOM_ID, building: 'Building A', room_no: '204', capacity: 50 };
    expect(roomsTab.diffFields(row, room)).toEqual(['capacity']);
  });
});
