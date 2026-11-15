import { describe, expect, it } from 'vitest';
import type { EntityManager } from 'typeorm';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../codec/tab-spec';
import type { ValidatedWorkbook } from './validated-workbook';
import { DiffService } from './diff.service';

interface FakeEntity {
  id: string;
  key: string;
  value: string;
}
interface FakeRow {
  id?: string;
  key: string;
  value: string;
}

const idColumn: ColumnSpec = { key: 'id', type: 'uuid', label: { en: 'ID', bn: 'ID' } };
const keyColumn: ColumnSpec = {
  key: 'key',
  type: 'string',
  required: true,
  label: { en: 'Key', bn: 'Key' },
};
const valueColumn: ColumnSpec = {
  key: 'value',
  type: 'string',
  label: { en: 'Value', bn: 'Value' },
};

function makeTab(
  name: string,
  opts: { existing?: FakeEntity[]; deleteByAbsence?: boolean } = {},
): TabSpec<FakeEntity, FakeRow> {
  const existing = opts.existing ?? [];
  return {
    name,
    entity: class {} as any,
    excluded: [],
    dependsOn: [],
    columns: [idColumn, keyColumn, valueColumn],
    naturalKey: ['key'],
    deleteByAbsence: opts.deleteByAbsence ?? true,
    load: async () => existing,
    toRow: (_e: FakeEntity, _ctx: ExportContext) => ({}),
    fromRow(
      _cells: Record<string, string>,
      _rowNo: number,
      _ctx: ImportContext,
    ): { row: FakeRow } | { errors: RowError[] } {
      throw new Error('not exercised by DiffService tests');
    },
    keyOf: (x: FakeRow | FakeEntity) => x.key,
    diffFields: (row: FakeRow, existing: FakeEntity) =>
      row.value !== existing.value ? ['value'] : [],
    upsert: async (row: FakeRow) => row as any,
    remove: async () => undefined,
  };
}

function validatedFor(
  tabs: Record<string, { present: boolean; rows: unknown[] }>,
): ValidatedWorkbook {
  const full: ValidatedWorkbook['tabs'] = {};
  for (const [name, t] of Object.entries(tabs)) {
    full[name] = { present: t.present, rows: t.rows, errors: [], warnings: [] };
  }
  return {
    meta: {
      schema_version: 1,
      kind: 'BACKUP',
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      source_school_name: 'Test',
      source_school_slug: 'test',
    },
    tabs: full,
    errors: [],
    warnings: [],
    hardErrorCount: 0,
  };
}

describe('DiffService', () => {
  const manager = {} as EntityManager;
  const service = new DiffService();

  it('buckets rows into creates, updates, unchanged, and deletes', async () => {
    const tab = makeTab('a', {
      existing: [
        { id: '1', key: 'k1', value: 'old' }, // will be updated
        { id: '2', key: 'k2', value: 'same' }, // will be unchanged
        { id: '3', key: 'k3', value: 'gone' }, // absent from workbook -> deleted
      ],
    });

    const validated = validatedFor({
      a: {
        present: true,
        rows: [
          { id: '1', key: 'k1', value: 'new' },
          { id: '2', key: 'k2', value: 'same' },
          { key: 'k4', value: 'brand-new' }, // no id -> matched by key, none found -> create
        ],
      },
    });

    const report = await service.diff(validated, 'tenant-1', manager, [tab]);
    const tabDiff = report.tabs[0];

    expect(tabDiff).toMatchObject({ creates: 1, updates: 1, unchanged: 1, deletes: 1 });
    expect(tabDiff.changedFields).toEqual({ value: 1 });
    expect(tabDiff.samples.creates).toEqual(['k4']);
    expect(tabDiff.samples.updates).toEqual(['k1']);
    expect(tabDiff.samples.deletes).toEqual(['k3']);
    expect(report.totals).toEqual({ creates: 1, updates: 1, unchanged: 1, deletes: 1 });
  });

  it('[690] two rows matching one existing row is an error naming both, not two updates', async () => {
    const tab = makeTab('a', { existing: [{ id: '1', key: 'k1', value: 'old' }] });
    const validated = validatedFor({
      a: {
        present: true,
        rows: [
          { id: '1', key: 'other', value: 'a' }, // matches by id
          { key: 'k1', value: 'b' }, // no id: matches the same entity by key
        ],
      },
    });
    const report = await service.diff(validated, 'tenant-1', manager, [tab]);
    expect(report.tabs[0].updates).toBe(1);
    expect(report.diffErrors).toHaveLength(1);
    expect(report.diffErrors[0]).toMatchObject({ tab: 'a', severity: 'error' });
    expect(report.diffErrors[0].message).toContain('other');
    expect(report.diffErrors[0].message).toContain('k1');
    expect(report.hardErrorCount).toBe(1);
  });

  it('never produces deletes for a tab with deleteByAbsence: false', async () => {
    const tab = makeTab('a', {
      existing: [{ id: '1', key: 'k1', value: 'old' }],
      deleteByAbsence: false,
    });
    const validated = validatedFor({ a: { present: true, rows: [] } });

    const report = await service.diff(validated, 'tenant-1', manager, [tab]);

    expect(report.tabs[0].deletes).toBe(0);
  });

  it('yields all-zero counts for a tab that is not present', async () => {
    const tab = makeTab('a', { existing: [{ id: '1', key: 'k1', value: 'x' }] });
    const validated = validatedFor({ a: { present: false, rows: [] } });

    const report = await service.diff(validated, 'tenant-1', manager, [tab]);

    expect(report.tabs[0]).toMatchObject({
      present: false,
      creates: 0,
      updates: 0,
      unchanged: 0,
      deletes: 0,
    });
  });

  it('isEmptyTenant is true when every present non-school tab has no existing rows', async () => {
    const tabA = makeTab('a', { existing: [] });
    const tabSchool = makeTab('school', { existing: [{ id: 's', key: 'school', value: 'x' }] });
    const validated = validatedFor({
      a: { present: true, rows: [] },
      school: { present: true, rows: [] },
    });

    const report = await service.diff(validated, 'tenant-1', manager, [tabA, tabSchool]);

    expect(report.isEmptyTenant).toBe(true);
  });

  it('isEmptyTenant is false when a present non-school tab already has rows', async () => {
    const tabA = makeTab('a', { existing: [{ id: '1', key: 'k1', value: 'x' }] });
    const validated = validatedFor({ a: { present: true, rows: [] } });

    const report = await service.diff(validated, 'tenant-1', manager, [tabA]);

    expect(report.isEmptyTenant).toBe(false);
  });

  it('never previews deletes for an insert-only tab (D13)', async () => {
    const tab = makeTab('payment_allocations', {
      existing: [{ id: '1', key: 'k1', value: 'old' }],
    });
    const validated = validatedFor({ payment_allocations: { present: true, rows: [] } });
    const report = await service.diff(validated, 'tenant-1', manager, [tab]);
    expect(report.tabs[0].deletes).toBe(0);
  });

  describe('student seat preflight (#1654)', () => {
    const seatManager = (limit: number | null, used: number) =>
      ({
        query: async (sql: string) =>
          sql.includes('count(*)') ? [{ n: String(used) }] : [{ seat_limit: limit }],
      }) as unknown as EntityManager;
    const studentRows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: `new${i}`,
        value: 'x',
        enrollment_status: 'ACTIVE',
      }));

    it('adds a hard error when new ACTIVE students would pass seat_limit', async () => {
      const tab = makeTab('students');
      const validated = validatedFor({ students: { present: true, rows: studentRows(6) } });
      const report = await service.diff(validated, 't', seatManager(50, 45), [tab]);
      expect(report.hardErrorCount).toBe(1);
      expect(report.diffErrors[0]).toMatchObject({ tab: 'students', severity: 'error' });
      expect(report.diffErrors[0].message).toContain('50');
    });

    it('passes at exactly the limit, and when the limit is null', async () => {
      const tab = makeTab('students');
      const validated = validatedFor({ students: { present: true, rows: studentRows(5) } });
      expect((await service.diff(validated, 't', seatManager(50, 45), [tab])).hardErrorCount).toBe(0);
      const big = validatedFor({ students: { present: true, rows: studentRows(500) } });
      expect((await service.diff(big, 't', seatManager(null, 45), [tab])).hardErrorCount).toBe(0);
    });

    it('does not credit ACTIVE students the restore deletes (apply takes seats first)', async () => {
      const tab = makeTab('students', {
        existing: [{ id: '1', key: 'gone', value: 'x', enrollment_status: 'ACTIVE' } as any],
      });
      const validated = validatedFor({ students: { present: true, rows: studentRows(6) } });
      const report = await service.diff(validated, 't', seatManager(50, 45), [tab]);
      expect(report.hardErrorCount).toBe(1);
    });
  });
});
