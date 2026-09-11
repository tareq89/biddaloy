import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import type { ReadWorkbookResult, SheetData } from '../codec/workbook-codec';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../codec/tab-spec';

const { readWorkbook } = vi.hoisted(() => ({ readWorkbook: vi.fn() }));

vi.mock('../codec/workbook-codec', async () => {
  const actual =
    await vi.importActual<typeof import('../codec/workbook-codec')>('../codec/workbook-codec');
  return { ...actual, readWorkbook };
});

// Imported after the mock so the service picks up the mocked `readWorkbook`.
import { ValidationService } from './validation.service';

/** A trivial in-memory row: just an id and a natural key. */
interface FakeRow {
  id: string;
  key: string;
  ref?: string;
}

const idColumn: ColumnSpec = {
  key: 'id',
  type: 'uuid',
  required: true,
  label: { en: 'ID', bn: 'ID' },
};
const keyColumn: ColumnSpec = {
  key: 'key',
  type: 'string',
  required: true,
  label: { en: 'Key', bn: 'Key' },
};

function makeTab(
  name: string,
  opts: { dependsOn?: readonly string[]; existing?: FakeRow[]; refTab?: string } = {},
): TabSpec<FakeRow, FakeRow> {
  const existing = opts.existing ?? [];
  const columns: readonly ColumnSpec[] = opts.refTab
    ? [
        idColumn,
        keyColumn,
        { key: 'ref', type: 'ref', ref: opts.refTab, label: { en: 'Ref', bn: 'Ref' } },
      ]
    : [idColumn, keyColumn];

  return {
    name,
    entity: class {} as any,
    excluded: [],
    dependsOn: opts.dependsOn ?? [],
    columns,
    naturalKey: ['key'],
    deleteByAbsence: true,
    load: async () => existing as any,
    toRow: (_e: any, _ctx: ExportContext) => ({}),
    fromRow(
      cells: Record<string, string>,
      rowNo: number,
      ctx: ImportContext,
    ): { row: FakeRow } | { errors: RowError[] } {
      const errors: RowError[] = [];
      const key = cells.key ?? '';
      if (!key)
        errors.push({
          tab: name,
          row: rowNo,
          column: 'key',
          severity: 'error',
          message: 'key required',
        });

      let ref: string | undefined;
      if (opts.refTab) {
        const refKey = cells.ref ?? '';
        if (refKey) {
          ref = ctx.ref(opts.refTab, refKey);
          if (!ref) {
            errors.push({
              tab: name,
              row: rowNo,
              column: 'ref',
              severity: 'error',
              message: `row ${rowNo}: unresolved reference "${refKey}" to tab "${opts.refTab}"`,
            });
          }
        }
      }

      if (errors.length > 0) return { errors };
      return { row: { id: cells.id || `gen-${rowNo}`, key, ref } };
    },
    keyOf: (x: FakeRow) => x.key,
    diffFields: () => [],
    upsert: async (row: FakeRow) => row as any,
    remove: async () => undefined,
  };
}

function sheet(
  header: string[],
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
): SheetData {
  return { header, rows };
}

function fakeReadResult(
  sheets: Map<string, SheetData>,
  warnings: RowError[] = [],
): ReadWorkbookResult {
  return {
    meta: {
      schema_version: 1,
      kind: 'BACKUP',
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      source_school_name: 'Test School',
      source_school_slug: 'test-school',
    },
    sheets,
    warnings,
  };
}

describe('ValidationService', () => {
  const manager = {} as EntityManager;

  it('reports a dangling cross-tab reference by row, column, and key', async () => {
    const tabA = makeTab('a');
    const tabB = makeTab('b', { dependsOn: ['a'], refTab: 'a' });
    const tabC = makeTab('c');

    readWorkbook.mockResolvedValue(
      fakeReadResult(
        new Map([
          ['a', sheet(['id', 'key'], [{ rowNo: 2, cells: { id: '', key: 'a1' } }])],
          [
            'b',
            sheet(
              ['id', 'key', 'ref'],
              [{ rowNo: 2, cells: { id: '', key: 'b1', ref: 'missing' } }],
            ),
          ],
        ]),
      ),
    );

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.b.errors).toHaveLength(1);
    expect(result.tabs.b.errors[0]).toMatchObject({
      tab: 'b',
      row: 2,
      column: 'ref',
    });
    expect(result.tabs.b.errors[0].message).toContain('missing');
    expect(result.hardErrorCount).toBe(1);
  });

  it('resolves a reference to a row defined earlier in the same workbook', async () => {
    const tabA = makeTab('a');
    const tabB = makeTab('b', { dependsOn: ['a'], refTab: 'a' });
    const tabC = makeTab('c');

    readWorkbook.mockResolvedValue(
      fakeReadResult(
        new Map([
          ['a', sheet(['id', 'key'], [{ rowNo: 2, cells: { id: '', key: 'a1' } }])],
          [
            'b',
            sheet(['id', 'key', 'ref'], [{ rowNo: 2, cells: { id: '', key: 'b1', ref: 'a1' } }]),
          ],
        ]),
      ),
    );

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.b.errors).toHaveLength(0);
    expect(result.tabs.b.rows).toHaveLength(1);
    expect((result.tabs.b.rows[0] as FakeRow).ref).toBe('pending:a:a1');
  });

  it('flags a duplicate natural key with an error on both rows', async () => {
    const tabA = makeTab('a');
    const tabB = makeTab('b');
    const tabC = makeTab('c');

    readWorkbook.mockResolvedValue(
      fakeReadResult(
        new Map([
          [
            'a',
            sheet(
              ['id', 'key'],
              [
                { rowNo: 2, cells: { id: '', key: 'dup' } },
                { rowNo: 3, cells: { id: '', key: 'dup' } },
              ],
            ),
          ],
        ]),
      ),
    );

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.a.errors).toHaveLength(2);
    expect(result.tabs.a.errors.map((e) => e.row).sort()).toEqual([2, 3]);
    expect(result.tabs.a.rows).toHaveLength(0);
  });

  it('flags every row when the same key appears three or more times', async () => {
    const tabA = makeTab('a');
    const tabB = makeTab('b');
    const tabC = makeTab('c');

    readWorkbook.mockResolvedValue(
      fakeReadResult(
        new Map([
          [
            'a',
            sheet(
              ['id', 'key'],
              [
                { rowNo: 2, cells: { id: '', key: 'dup' } },
                { rowNo: 3, cells: { id: '', key: 'dup' } },
                { rowNo: 4, cells: { id: '', key: 'dup' } },
              ],
            ),
          ],
        ]),
      ),
    );

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.a.errors).toHaveLength(3);
    expect(result.tabs.a.errors.map((e) => e.row).sort()).toEqual([2, 3, 4]);
    expect(result.tabs.a.rows).toHaveLength(0);
  });

  it('marks a missing sheet as a warning and present: false', async () => {
    const tabA = makeTab('a');
    const tabB = makeTab('b');
    const tabC = makeTab('c');

    readWorkbook.mockResolvedValue(fakeReadResult(new Map([['a', sheet(['id', 'key'], [])]])));

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.b.present).toBe(false);
    expect(result.tabs.c.present).toBe(false);
    expect(result.warnings.some((w) => w.tab === 'b' && /not present/.test(w.message))).toBe(true);
  });

  it('reports a missing required column as one tab-level error', async () => {
    const tabA = makeTab('a');
    const tabB = makeTab('b');
    const tabC = makeTab('c');

    readWorkbook.mockResolvedValue(
      fakeReadResult(new Map([['a', sheet(['id'], [{ rowNo: 2, cells: { id: 'x' } }])]])),
    );

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.a.errors).toHaveLength(1);
    expect(result.tabs.a.errors[0].column).toBeNull();
    expect(result.tabs.a.rows).toHaveLength(0);
  });

  it('caps stored errors at 1000 and adds a "…and N more" warning', async () => {
    const tabA = makeTab('a');
    const tabB = makeTab('b');
    const tabC = makeTab('c');

    const rows = Array.from({ length: 1001 }, (_, i) => ({
      rowNo: i + 2,
      cells: { id: '', key: '' },
    }));

    readWorkbook.mockResolvedValue(fakeReadResult(new Map([['a', sheet(['id', 'key'], rows)]])));

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.a.errors).toHaveLength(1000);
    expect(result.errors).toHaveLength(1000);
    expect(result.hardErrorCount).toBe(1001);
    expect(result.warnings.some((w) => /and 1 more/.test(w.message))).toBe(true);
  });
});
