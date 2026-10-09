import { expect } from 'vitest';
import { cellText, toCell } from '../../codec/cell-format';
import type { ImportContext, TabSpec } from '../../codec/tab-spec';

/**
 * Test helper for the `createRefChildTab` tabs: exports one entity to cells,
 * re-imports the cells, and checks the natural key and diff survive.
 * `keys` maps tab name -> (id -> natural key) for every referenced tab;
 * `stamp` is what `load()` would put on the entity (ref column -> key text).
 */
export function roundTrip<E>(
  tab: TabSpec<E, Record<string, unknown>>,
  entity: E,
  stamp: Record<string, string>,
  keys: Record<string, Record<string, string>>,
): Record<string, unknown> {
  (entity as Record<string, unknown>).__refKeys = stamp;
  const out = tab.toRow(entity, { keyOf: (t, id) => keys[t]?.[id] ?? '' });
  const cells: Record<string, string> = {};
  for (const c of tab.columns) {
    const cell = toCell(c.type, out[c.key]);
    cells[c.key] = cellText(cell === null ? '' : String(cell));
  }
  const ctx: ImportContext = {
    tenantId: 'tenant',
    ref: (t, key) => Object.entries(keys[t] ?? {}).find(([, k]) => k === key)?.[0],
    warn: () => undefined,
  };
  const res = tab.fromRow(cells, 2, ctx);
  if ('errors' in res) throw new Error(JSON.stringify(res.errors));
  expect(tab.keyOf(res.row)).toBe(tab.keyOf(entity));
  expect(tab.diffFields(res.row, entity)).toEqual([]);
  return res.row;
}
