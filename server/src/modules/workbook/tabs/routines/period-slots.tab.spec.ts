import { describe, expect, it } from 'vitest';
import { Shift } from '../../../routines/entities/shift.entity';
import { PeriodSlot } from '../../../routines/entities/period-slot.entity';
import { PeriodSlotKind } from '@biddaloy/shared';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { shiftsTab } from './shifts.tab';
import { periodSlotsTab, type PeriodSlotRow } from './period-slots.tab';

const SLOT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => (tab === 'shifts' && id === SHIFT_ID ? 'Morning' : ''),
};
function makeImportCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => (tab === 'shifts' && key === 'Morning' ? SHIFT_ID : undefined),
    warn: () => undefined,
  };
}

function makeSlot(overrides: Partial<PeriodSlot> = {}): PeriodSlot {
  return Object.assign(new PeriodSlot(), {
    id: SLOT_ID,
    shift_id: SHIFT_ID,
    shift: Object.assign(new Shift(), { id: SHIFT_ID, name: 'Morning' }),
    sequence: 4,
    kind: PeriodSlotKind.BREAK,
    name: 'Lunch',
    starts_at: '10:00:00',
    ends_at: '10:30:00',
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<PeriodSlot>);
}

function toCells(slot: PeriodSlot): Record<string, string> {
  const row = periodSlotsTab.toRow(slot, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of periodSlotsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('periodSlotsTab shape', () => {
  it('satisfies the registry contract together with shifts', () => {
    expect(() => assertRegistryValid([shiftsTab, periodSlotsTab], { partial: true })).not.toThrow();
  });

  it('depends on shifts, deletes by absence', () => {
    expect(periodSlotsTab.name).toBe('period_slots');
    expect(periodSlotsTab.dependsOn).toEqual(['shifts']);
    expect(periodSlotsTab.naturalKey).toEqual(['shift', 'sequence']);
    expect(periodSlotsTab.deleteByAbsence).toBe(true);
  });

  it('keys a slot by shift and sequence', () => {
    expect(periodSlotsTab.keyOf(makeSlot())).toBe('Morning|4');
  });
});

describe('round trip', () => {
  it('round-trips a BREAK slot', () => {
    const slot = makeSlot();
    const result = periodSlotsTab.fromRow(toCells(slot), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SLOT_ID,
        shift_id: SHIFT_ID,
        shift_key: 'Morning',
        sequence: 4,
        kind: PeriodSlotKind.BREAK,
        name: 'Lunch',
        starts_at: '10:00:00',
        ends_at: '10:30:00',
      } satisfies PeriodSlotRow,
    });
  });

  it('round-trips a CLASS slot with no name', () => {
    const slot = makeSlot({
      sequence: 1,
      kind: PeriodSlotKind.CLASS,
      name: null,
      starts_at: '08:00:00',
      ends_at: '08:40:00',
    });
    const result = periodSlotsTab.fromRow(toCells(slot), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SLOT_ID,
        shift_id: SHIFT_ID,
        shift_key: 'Morning',
        sequence: 1,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      } satisfies PeriodSlotRow,
    });
  });

  it('reports a RowError on a ref miss', () => {
    const cells = { ...toCells(makeSlot()), shift: 'nonexistent' };
    const result = periodSlotsTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({ column: 'shift', row: 3 });
  });
});

describe('diffFields', () => {
  it('reports a changed kind', () => {
    const slot = makeSlot();
    const row: PeriodSlotRow = {
      id: SLOT_ID,
      shift_id: SHIFT_ID,
      shift_key: 'Morning',
      sequence: 4,
      kind: PeriodSlotKind.CLASS,
      name: 'Lunch',
      starts_at: '10:00:00',
      ends_at: '10:30:00',
    };
    expect(periodSlotsTab.diffFields(row, slot)).toEqual(['kind']);
  });
});
