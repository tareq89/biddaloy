import { describe, expect, it } from 'vitest';
import { Shift } from '../../../routines/entities/shift.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { shiftsTab, type ShiftRow } from './shifts.tab';

const SHIFT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = { keyOf: () => '' };
function makeImportCtx(): ImportContext {
  return { tenantId: TENANT_ID, ref: () => undefined, warn: () => undefined };
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return Object.assign(new Shift(), {
    id: SHIFT_ID,
    name: 'Morning',
    day_starts_at: '08:00:00',
    day_ends_at: '13:00:00',
    sequence: 1,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Shift>);
}

function toCells(shift: Shift): Record<string, string> {
  const row = shiftsTab.toRow(shift, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of shiftsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('shiftsTab shape', () => {
  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([shiftsTab], { partial: true })).not.toThrow();
  });

  it('has no dependencies, deletes by absence', () => {
    expect(shiftsTab.name).toBe('shifts');
    expect(shiftsTab.dependsOn).toEqual([]);
    expect(shiftsTab.naturalKey).toEqual(['name']);
    expect(shiftsTab.deleteByAbsence).toBe(true);
  });

  it('keys a shift by name', () => {
    expect(shiftsTab.keyOf(makeShift())).toBe('Morning');
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const shift = makeShift();
    const result = shiftsTab.fromRow(toCells(shift), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SHIFT_ID,
        name: 'Morning',
        day_starts_at: '08:00:00',
        day_ends_at: '13:00:00',
        sequence: 1,
      } satisfies ShiftRow,
    });
  });

  it('rejects a missing required name', () => {
    const cells = { ...toCells(makeShift()), name: '' };
    const result = shiftsTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('name');
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const shift = makeShift();
    const row: ShiftRow = {
      id: SHIFT_ID,
      name: 'Morning',
      day_starts_at: '08:00:00',
      day_ends_at: '13:00:00',
      sequence: 1,
    };
    expect(shiftsTab.diffFields(row, shift)).toEqual([]);
  });

  it('reports a changed sequence', () => {
    const shift = makeShift();
    const row: ShiftRow = {
      id: SHIFT_ID,
      name: 'Morning',
      day_starts_at: '08:00:00',
      day_ends_at: '13:00:00',
      sequence: 2,
    };
    expect(shiftsTab.diffFields(row, shift)).toEqual(['sequence']);
  });
});
