import { describe, expect, it } from 'vitest';
import { RoutineSlot } from '../../../routines/entities/routine-slot.entity';
import { RoutineSubstitution } from '../../../routines/entities/routine-substitution.entity';
import { User } from '../../../users/entities/user.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { routineSubstitutionsTab, type RoutineSubstitutionRow } from './routine-substitutions.tab';

const SUB_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_BY_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const keys: Record<string, Record<string, string>> = {
  routine_slots: { [SLOT_ID]: 'slot-key' },
  users: { [CREATED_BY_ID]: 'admin@biddaloy.test' },
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

function makeSub(overrides: Partial<RoutineSubstitution> = {}): RoutineSubstitution {
  return Object.assign(new RoutineSubstitution(), {
    id: SUB_ID,
    routine_slot_id: SLOT_ID,
    routine_slot: Object.assign(new RoutineSlot(), { id: SLOT_ID }),
    date: '2026-02-09',
    substitute_teacher_id: null,
    substitute_teacher: null,
    is_cancelled: true,
    reason: 'Teacher on leave',
    created_by: CREATED_BY_ID,
    created_by_user: Object.assign(new User(), { id: CREATED_BY_ID, email: 'admin@biddaloy.test' }),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<RoutineSubstitution>);
}

function toCells(sub: RoutineSubstitution): Record<string, string> {
  const row = routineSubstitutionsTab.toRow(sub, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of routineSubstitutionsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('routineSubstitutionsTab shape', () => {
  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([routineSubstitutionsTab], { partial: true })).not.toThrow();
  });

  it('depends on routine_slots, teachers, users', () => {
    expect(routineSubstitutionsTab.name).toBe('routine_substitutions');
    expect(routineSubstitutionsTab.dependsOn).toEqual(['routine_slots', 'teachers', 'users']);
    expect(routineSubstitutionsTab.naturalKey).toEqual(['routine_slot', 'date']);
  });
});

describe('round trip', () => {
  // The trap a naive codec flattens: a cancellation has a null substitute.
  it('round-trips a cancellation substitution with a null substitute teacher', () => {
    const sub = makeSub();
    const result = routineSubstitutionsTab.fromRow(toCells(sub), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SUB_ID,
        routine_slot_id: SLOT_ID,
        routine_slot_key: 'slot-key',
        date: '2026-02-09',
        substitute_teacher_id: null,
        substitute_teacher_key: null,
        is_cancelled: true,
        reason: 'Teacher on leave',
        created_by: CREATED_BY_ID,
        created_by_key: 'admin@biddaloy.test',
      } satisfies RoutineSubstitutionRow,
    });
  });

  it('round-trips a covered (not cancelled) substitution with a substitute teacher', () => {
    keys.teachers = { '44444444-4444-4444-8444-444444444444': 'EMP-2' };
    const sub = makeSub({
      is_cancelled: false,
      substitute_teacher_id: '44444444-4444-4444-8444-444444444444',
    });
    const result = routineSubstitutionsTab.fromRow(toCells(sub), 2, makeImportCtx());

    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.row.is_cancelled).toBe(false);
    expect(result.row.substitute_teacher_key).toBe('EMP-2');
  });
});

describe('diffFields', () => {
  it('reports a changed is_cancelled', () => {
    const sub = makeSub();
    const row: RoutineSubstitutionRow = {
      id: SUB_ID,
      routine_slot_id: SLOT_ID,
      routine_slot_key: 'slot-key',
      date: '2026-02-09',
      substitute_teacher_id: null,
      substitute_teacher_key: null,
      is_cancelled: false,
      reason: 'Teacher on leave',
      created_by: CREATED_BY_ID,
      created_by_key: 'admin@biddaloy.test',
    };
    expect(routineSubstitutionsTab.diffFields(row, sub)).toEqual(['is_cancelled']);
  });
});
