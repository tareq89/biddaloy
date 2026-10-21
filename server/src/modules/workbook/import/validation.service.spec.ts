import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { ValidationBusyError, ValidationService } from './validation.service';

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
  opts: {
    dependsOn?: readonly string[];
    existing?: FakeRow[];
    refTab?: string;
    allowDuplicateKeys?: boolean;
    changed?: boolean;
  } = {},
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
    allowDuplicateKeys: opts.allowDuplicateKeys,
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
    diffFields: () => (opts.changed ? ['value'] : []),
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

  // #2686 (D17): two validates share the process; the third is refused or
  // waits. Held promises are the latch — no timing, no sleeps.
  describe('two validates per process', () => {
    const tab = makeTab('a');
    beforeEach(() => readWorkbook.mockReset());
    /** A `readWorkbook` call that stays open until the test releases it. */
    function hold() {
      let release!: (r: ReadWorkbookResult) => void;
      let fail!: (e: Error) => void;
      readWorkbook.mockReturnValueOnce(
        new Promise<ReadWorkbookResult>((resolve, reject) => {
          release = resolve;
          fail = reject;
        }),
      );
      return { release: () => release(fakeReadResult(new Map())), fail };
    }

    it('runs two schools at once and refuses a third without waitIfBusy', async () => {
      const service = new ValidationService();
      const a = hold();
      const b = hold();
      const first = service.validate(Buffer.from(''), 't1', manager, [tab]);
      const second = service.validate(Buffer.from(''), 't2', manager, [tab]);
      // Both are genuinely in flight: readWorkbook was entered twice.
      expect(readWorkbook).toHaveBeenCalledTimes(2);
      // A third upload is refused, fail-closed — and the limit is per
      // process, not per service object.
      await expect(
        new ValidationService().validate(Buffer.from(''), 't3', manager, [tab]),
      ).rejects.toBeInstanceOf(ValidationBusyError);

      a.release();
      b.release();
      await expect(first).resolves.toMatchObject({ hardErrorCount: 0 });
      await expect(second).resolves.toMatchObject({ hardErrorCount: 0 });
    });

    it('starts a waitIfBusy caller only after one of the two running finishes', async () => {
      const service = new ValidationService();
      const a = hold();
      const b = hold();
      const first = service.validate(Buffer.from(''), 't1', manager, [tab]);
      const second = service.validate(Buffer.from(''), 't2', manager, [tab]);
      readWorkbook.mockResolvedValueOnce(fakeReadResult(new Map()));
      // The restore worker waits for its turn instead of failing.
      const queued = service.validate(Buffer.from(''), 't3', manager, [tab], { waitIfBusy: true });
      await Promise.resolve();
      expect(readWorkbook).toHaveBeenCalledTimes(2);

      a.release();
      await expect(first).resolves.toMatchObject({ hardErrorCount: 0 });
      await expect(queued).resolves.toMatchObject({ hardErrorCount: 0 });
      // It ran once a slot freed, while the second was still open.
      expect(readWorkbook).toHaveBeenCalledTimes(3);

      b.release();
      await expect(second).resolves.toMatchObject({ hardErrorCount: 0 });
    });

    it('frees the slot when a run rejects', async () => {
      const service = new ValidationService();
      const a = hold();
      const b = hold();
      const first = service.validate(Buffer.from(''), 't1', manager, [tab]);
      const second = service.validate(Buffer.from(''), 't2', manager, [tab]);

      a.fail(new Error('boom'));
      await expect(first).rejects.toThrow('boom');
      // The failed run's slot is free again: a third is accepted.
      readWorkbook.mockResolvedValueOnce(fakeReadResult(new Map()));
      await expect(service.validate(Buffer.from(''), 't3', manager, [tab])).resolves.toMatchObject(
        { hardErrorCount: 0 },
      );

      b.release();
      await expect(second).resolves.toMatchObject({ hardErrorCount: 0 });
    });
  });

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

  it('warns a BACKUP once about what a backup does not contain; a TEMPLATE gets none', async () => {
    const tabA = makeTab('a');
    const sheets = () => new Map([['a', sheet(['id', 'key'], [])]]);
    const service = new ValidationService();

    readWorkbook.mockResolvedValue(fakeReadResult(sheets()));
    const backup = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA]);
    const notes = backup.warnings.filter((w) => w.tab === '*');
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('student wallet balances');

    const tpl = fakeReadResult(sheets());
    tpl.meta.kind = 'TEMPLATE';
    readWorkbook.mockResolvedValue(tpl);
    const template = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA]);
    expect(template.warnings.filter((w) => w.tab === '*')).toHaveLength(0);
  });

  describe('anonymous surveys', () => {
    const svTab = (anonymous: boolean) => {
      const t = makeTab('surveys', { existing: [{ id: 's1', key: 'S', anonymous } as any] });
      const base = t.fromRow;
      t.fromRow = (cells, rowNo, ctx) => {
        const r = base(cells, rowNo, ctx);
        return 'row' in r ? { row: { ...r.row, anonymous: cells.anonymous === 'true' } as any } : r;
      };
      return t;
    };
    const respTab = () => makeTab('survey_responses', { dependsOn: ['surveys'] });
    const run = async (
      surveys: Array<Record<string, string>>,
      responses: Array<Record<string, string>>,
    ) => {
      readWorkbook.mockResolvedValue(
        fakeReadResult(
          new Map([
            [
              'surveys',
              sheet(
                ['id', 'key', 'anonymous'],
                surveys.map((cells, i) => ({ rowNo: i + 2, cells })),
              ),
            ],
            [
              'survey_responses',
              sheet(
                ['id', 'key', 'survey'],
                responses.map((cells, i) => ({ rowNo: i + 2, cells })),
              ),
            ],
          ]),
        ),
      );
      return new ValidationService().validate(Buffer.from(''), 't', manager, [
        svTab(true),
        respTab(),
      ]);
    };

    it('skips, with a warning, response rows of an anonymous survey (older file)', async () => {
      const r = await run(
        [{ id: 's1', key: 'S', anonymous: 'true' }],
        [{ id: '', key: 'r1', survey: 'S' }],
      );
      expect(r.tabs.survey_responses.rows).toHaveLength(0);
      expect(r.hardErrorCount).toBe(0);
      expect(
        r.warnings.some((w) => w.tab === 'survey_responses' && /anonymous survey/.test(w.message)),
      ).toBe(true);
    });

    it('skips answer rows whose response key starts with an anonymous survey key', async () => {
      readWorkbook.mockResolvedValue(
        fakeReadResult(
          new Map([
            [
              'surveys',
              sheet(
                ['id', 'key', 'anonymous'],
                [{ rowNo: 2, cells: { id: 's1', key: 'S', anonymous: 'true' } }],
              ),
            ],
            [
              'survey_answers',
              sheet(
                ['id', 'key', 'response'],
                [{ rowNo: 2, cells: { id: '', key: 'a1', response: 'S|x' } }],
              ),
            ],
          ]),
        ),
      );
      const r = await new ValidationService().validate(Buffer.from(''), 't', manager, [
        svTab(true),
        makeTab('survey_answers', { dependsOn: ['surveys'] }),
      ]);
      expect(r.tabs.survey_answers.rows).toHaveLength(0);
      expect(r.hardErrorCount).toBe(0);
      expect(
        r.warnings.some((w) => w.tab === 'survey_answers' && /anonymous survey/.test(w.message)),
      ).toBe(true);
    });

    it('refuses a restore that changes anonymous on an existing survey', async () => {
      const r = await run([{ id: 's1', key: 'S', anonymous: 'false' }], []);
      expect(r.hardErrorCount).toBe(1);
      expect(r.errors[0].message).toContain('anonymous');
    });
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

  it('allows a duplicate key on an allowDuplicateKeys tab when both rows resolve to distinct existing entities', async () => {
    const tabA = makeTab('a', {
      allowDuplicateKeys: true,
      existing: [
        { id: 'e1', key: 'dup' },
        { id: 'e2', key: 'dup' },
      ],
    });
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
                { rowNo: 2, cells: { id: 'e1', key: 'dup' } },
                { rowNo: 3, cells: { id: 'e2', key: 'dup' } },
              ],
            ),
          ],
        ]),
      ),
    );

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.a.errors).toHaveLength(0);
    expect(result.tabs.a.rows).toHaveLength(2);
  });

  it('allows a duplicate key on an allowDuplicateKeys tab when the key does not exist in the destination yet', async () => {
    const tabA = makeTab('a', { allowDuplicateKeys: true, existing: [] });
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

    expect(result.tabs.a.errors).toHaveLength(0);
    expect(result.tabs.a.rows).toHaveLength(2);
  });

  it('still rejects a duplicate key on an allowDuplicateKeys tab when one row has an unresolved id and the destination already has that key', async () => {
    const tabA = makeTab('a', { allowDuplicateKeys: true, existing: [{ id: 'e1', key: 'dup' }] });
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
    expect(result.tabs.a.rows).toHaveLength(0);
  });

  it('still rejects a duplicate key on an allowDuplicateKeys tab when both rows carry the same id', async () => {
    const tabA = makeTab('a', { allowDuplicateKeys: true, existing: [{ id: 'e1', key: 'dup' }] });
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
                { rowNo: 2, cells: { id: 'e1', key: 'dup' } },
                { rowNo: 3, cells: { id: 'e1', key: 'dup' } },
              ],
            ),
          ],
        ]),
      ),
    );

    const service = new ValidationService();
    const result = await service.validate(Buffer.from(''), 'tenant-1', manager, [tabA, tabB, tabC]);

    expect(result.tabs.a.errors).toHaveLength(2);
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

  describe('insert-only tabs (D13)', () => {
    const rows = (key: string) =>
      new Map([['marks', sheet(['id', 'key'], [{ rowNo: 2, cells: { id: 'e1', key } }])]]);
    const run = (tab: TabSpec<FakeRow, FakeRow>, sheets: Map<string, SheetData>) => {
      readWorkbook.mockResolvedValue(fakeReadResult(sheets));
      return new ValidationService().validate(Buffer.from(''), 't', manager, [tab]);
    };

    it('errors on a changed existing row, naming the fields', async () => {
      const tab = makeTab('marks', { existing: [{ id: 'e1', key: 'k' }], changed: true });
      const r = await run(tab, rows('k'));
      expect(r.hardErrorCount).toBe(1);
      expect(r.errors[0].message).toContain('changes value of an existing record');
      expect(r.tabs.marks.rows).toHaveLength(0);
    });

    it('allows an unchanged matched row, no warning', async () => {
      const tab = makeTab('marks', { existing: [{ id: 'e1', key: 'k' }] });
      const r = await run(tab, rows('k'));
      expect(r.hardErrorCount).toBe(0);
      // The always-on "does not contain" backup note is not about this row.
      expect(r.warnings.filter((w) => !/does not contain/.test(w.message))).toHaveLength(0);
    });

    it('warns once, without error, when existing rows are absent from the file', async () => {
      const tab = makeTab('payments', { existing: [{ id: 'e9', key: 'z' }] });
      const r = await run(tab, new Map([['payments', sheet(['id', 'key'], [])]]));
      expect(r.hardErrorCount).toBe(0);
      expect(
        r.warnings.filter((w) => !/does not contain/.test(w.message)).map((w) => w.message),
      ).toEqual([
        '1 existing payments rows are not in this file. A restore never removes them; they will be kept.',
      ]);
    });

    // Review r1 #3: a BACKUP restore deletes rows the file leaves out; the
    // tab's checkRemove gets exactly those rows and each refusal is an error.
    it('passes only the absent rows to checkRemove and records its refusals', async () => {
      const tab = makeTab('students', {
        existing: [
          { id: 'kept', key: 'k' },
          { id: 'gone', key: 'g' },
        ],
      });
      tab.checkRemove = vi.fn().mockResolvedValue(['Student g still owes money.']);
      const r = await run(
        tab,
        new Map([
          ['students', sheet(['id', 'key'], [{ rowNo: 2, cells: { id: 'kept', key: 'k' } }])],
        ]),
      );
      expect(tab.checkRemove).toHaveBeenCalledWith([{ id: 'gone', key: 'g' }], 't', manager);
      expect(r.hardErrorCount).toBe(1);
      expect(r.errors[0].message).toBe('Student g still owes money.');
    });

    it('still lets a non-insert-only tab change', async () => {
      const tab = makeTab('academic_years', { existing: [{ id: 'e1', key: 'k' }], changed: true });
      const r = await run(
        tab,
        new Map([
          ['academic_years', sheet(['id', 'key'], [{ rowNo: 2, cells: { id: 'e1', key: 'k' } }])],
        ]),
      );
      expect(r.hardErrorCount).toBe(0);
    });
  });

  describe('blank actor on a new row (#2687)', () => {
    const WARNING =
      "This row's staff member has left the school; the restore will record you instead.";
    const ERROR = 'Choose a current staff member for this row; a new row needs one.';
    type Flag = 'restorerOnNewRow' | 'requiredOnNewRow';
    const run = (flag: Flag, existing: FakeRow[]) => {
      const base = makeTab('notes', { existing });
      const actor: ColumnSpec = {
        key: 'actor',
        type: 'string',
        [flag]: true,
        label: { en: 'Actor', bn: 'Actor' },
      };
      const tab = { ...base, columns: [...base.columns, actor] };
      const rows = [{ rowNo: 2, cells: { id: 'n1', key: 'k', actor: '' } }];
      readWorkbook.mockResolvedValue(
        fakeReadResult(new Map([['notes', sheet(['id', 'key', 'actor'], rows)]])),
      );
      return new ValidationService().validate(Buffer.from(''), 't', manager, [tab]);
    };
    const mine = (r: { warnings: RowError[] }) =>
      r.warnings.filter((w) => !/does not contain/.test(w.message));

    // A departed author is blank in the export; a fresh school attributes the row to the restorer.
    it('restorerOnNewRow: blank on a new row is a fixed-text warning, row accepted', async () => {
      const r = await run('restorerOnNewRow', []);
      expect(r.hardErrorCount).toBe(0);
      expect(mine(r).map((w) => w.message)).toEqual([WARNING]);
      expect(r.tabs.notes.rows).toHaveLength(1);
    });

    it('restorerOnNewRow: blank on an existing row gives no warning', async () => {
      const r = await run('restorerOnNewRow', [{ id: 'n1', key: 'k' }]);
      expect(r.hardErrorCount).toBe(0);
      expect(mine(r)).toHaveLength(0);
    });

    it('restorerOnNewRow: blank on a TEMPLATE row stays the error', async () => {
      const tpl = fakeReadResult(
        new Map([
          [
            'notes',
            sheet(['id', 'key', 'actor'], [{ rowNo: 2, cells: { id: 'n1', key: 'k', actor: '' } }]),
          ],
        ]),
      );
      tpl.meta.kind = 'TEMPLATE';
      readWorkbook.mockResolvedValue(tpl);
      const base = makeTab('notes', { existing: [] });
      const actor: ColumnSpec = {
        key: 'actor',
        type: 'string',
        restorerOnNewRow: true,
        label: { en: 'Actor', bn: 'Actor' },
      };
      const r = await new ValidationService().validate(Buffer.from(''), 't', manager, [
        { ...base, columns: [...base.columns, actor] },
      ]);
      expect(r.hardErrorCount).toBe(1);
      expect(r.errors[0].message).toBe(ERROR);
    });

    it('requiredOnNewRow: blank on a new row is still the error', async () => {
      const r = await run('requiredOnNewRow', []);
      expect(r.hardErrorCount).toBe(1);
      expect(r.errors[0].message).toBe(ERROR);
    });
  });
});
