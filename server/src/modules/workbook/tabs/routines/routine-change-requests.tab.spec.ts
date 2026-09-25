import { describe, expect, it } from 'vitest';
import { RoutineSlot } from '../../../routines/entities/routine-slot.entity';
import { RoutineChangeRequest } from '../../../routines/entities/routine-change-request.entity';
import { User } from '../../../users/entities/user.entity';
import { ChangeRequestState } from '@biddaloy/shared';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import {
  routineChangeRequestsTab,
  type RoutineChangeRequestRow,
} from './routine-change-requests.tab';

const REQUEST_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const REQUESTED_BY_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const keys: Record<string, Record<string, string>> = {
  routine_slots: { [SLOT_ID]: 'slot-key' },
  users: { [REQUESTED_BY_ID]: 'teacher1@biddaloy.test' },
};

const exportCtx: ExportContext = { keyOf: (tab, id) => keys[tab]?.[id] ?? '' };
function makeImportCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => {
      const table = keys[tab];
      const found = table && Object.entries(table).find(([, v]) => v === key);
      return found?.[0];
    },
    warn: () => undefined,
  };
}

function makeRequest(overrides: Partial<RoutineChangeRequest> = {}): RoutineChangeRequest {
  return Object.assign(new RoutineChangeRequest(), {
    id: REQUEST_ID,
    routine_slot_id: SLOT_ID,
    routine_slot: Object.assign(new RoutineSlot(), { id: SLOT_ID }),
    requested_by: REQUESTED_BY_ID,
    requested_by_user: Object.assign(new User(), {
      id: REQUESTED_BY_ID,
      email: 'teacher1@biddaloy.test',
    }),
    note: 'Requesting a swap',
    state: ChangeRequestState.OPEN,
    resolved_by: null,
    resolved_by_user: null,
    resolved_at: null,
    resolution_note: null,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<RoutineChangeRequest>);
}

function toCells(request: RoutineChangeRequest): Record<string, string> {
  const row = routineChangeRequestsTab.toRow(request, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of routineChangeRequestsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('routineChangeRequestsTab shape', () => {
  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([routineChangeRequestsTab], { partial: true })).not.toThrow();
  });

  it('depends on routine_slots and users', () => {
    expect(routineChangeRequestsTab.name).toBe('routine_change_requests');
    expect(routineChangeRequestsTab.dependsOn).toEqual(['routine_slots', 'users']);
    expect(routineChangeRequestsTab.naturalKey).toEqual(['routine_slot', 'requested_by', 'note']);
  });
});

describe('round trip', () => {
  it('round-trips an open request with no resolution', () => {
    const request = makeRequest();
    const result = routineChangeRequestsTab.fromRow(toCells(request), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: REQUEST_ID,
        routine_slot_id: SLOT_ID,
        routine_slot_key: 'slot-key',
        requested_by: REQUESTED_BY_ID,
        requested_by_key: 'teacher1@biddaloy.test',
        note: 'Requesting a swap',
        state: ChangeRequestState.OPEN,
        resolved_by: null,
        resolved_by_key: null,
        resolved_at: null,
        resolution_note: null,
      } satisfies RoutineChangeRequestRow,
    });
  });

  it('round-trips an accepted request with resolution fields set', () => {
    keys.users!['44444444-4444-4444-8444-444444444444'] = 'admin@biddaloy.test';
    const request = makeRequest({
      state: ChangeRequestState.ACCEPTED,
      resolved_by: '44444444-4444-4444-8444-444444444444',
      resolved_by_user: Object.assign(new User(), {
        id: '44444444-4444-4444-8444-444444444444',
        email: 'admin@biddaloy.test',
      }),
      resolved_at: new Date('2026-02-10T00:00:00.000Z'),
      resolution_note: 'Approved, moved to period 5',
    });
    const result = routineChangeRequestsTab.fromRow(toCells(request), 2, makeImportCtx());

    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.row.state).toBe(ChangeRequestState.ACCEPTED);
    expect(result.row.resolved_by_key).toBe('admin@biddaloy.test');
    expect(result.row.resolved_at).toBe('2026-02-10T00:00:00.000Z');
    expect(result.row.resolution_note).toBe('Approved, moved to period 5');
  });
});

describe('diffFields', () => {
  it('reports a changed state', () => {
    const request = makeRequest();
    const row: RoutineChangeRequestRow = {
      id: REQUEST_ID,
      routine_slot_id: SLOT_ID,
      routine_slot_key: 'slot-key',
      requested_by: REQUESTED_BY_ID,
      requested_by_key: 'teacher1@biddaloy.test',
      note: 'Requesting a swap',
      state: ChangeRequestState.REJECTED,
      resolved_by: null,
      resolved_by_key: null,
      resolved_at: null,
      resolution_note: null,
    };
    expect(routineChangeRequestsTab.diffFields(row, request)).toEqual(['state']);
  });
});
