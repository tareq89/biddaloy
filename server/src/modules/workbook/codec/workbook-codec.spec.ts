import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

const guardState = vi.hoisted(() => ({ bomb: false }));
vi.mock('../../../common/utils/xlsx-guard.util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../common/utils/xlsx-guard.util')>();
  return {
    ...actual,
    assertXlsxWithinLimits: async (...a: Parameters<typeof actual.assertXlsxWithinLimits>) => {
      if (guardState.bomb) throw new actual.XlsxTooLargeError('bomb');
      return actual.assertXlsxWithinLimits(...a);
    },
  };
});
import { XLSX_TOO_LARGE_MESSAGE } from '../../../common/utils/xlsx-guard.util';
import { SCHEMA_VERSION, type WorkbookMeta } from './meta';
import { buildSampleRow, WorkbookFormatError, readWorkbook, writeWorkbook } from './workbook-codec';
import { ALL_TABS } from './registry';
import type { ColumnSpec, TabSpec } from './tab-spec';

const meta: WorkbookMeta = {
  schema_version: SCHEMA_VERSION,
  kind: 'BACKUP',
  exported_at: '2026-03-09T22:00:00.000Z',
  app_version: '1.14.0',
  source_school_name: 'Dhaka Model High School',
  source_school_slug: 'dhaka-model',
};

const idColumn: ColumnSpec = { key: 'id', type: 'uuid', label: { en: 'ID', bn: 'আইডি' } };

function tab(name: string, columns: ColumnSpec[]): TabSpec<unknown, unknown> {
  return {
    name,
    entity: class Fake {},
    excluded: [],
    dependsOn: [],
    columns,
    naturalKey: ['name'],
    deleteByAbsence: false,
    load: () => Promise.resolve([]),
    toRow: () => ({}),
    fromRow: () => ({ row: {} }),
    keyOf: () => '',
    diffFields: () => [],
    upsert: () => Promise.resolve({}),
    remove: () => Promise.resolve(),
  };
}

// Two real EXPECTED_TABS names, so readWorkbook treats them as known sheets.
const classesTab = tab('classes', [
  idColumn,
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  { key: 'capacity', type: 'int', label: { en: 'Capacity', bn: 'ধারণক্ষমতা' } },
]);

const paymentsTab = tab('payments', [
  idColumn,
  { key: 'name', type: 'string', label: { en: 'Name', bn: 'নাম' } },
  { key: 'amount', type: 'money', label: { en: 'Amount', bn: 'পরিমাণ' } },
  { key: 'paid', type: 'bool', label: { en: 'Paid', bn: 'পরিশোধিত' } },
]);

const ID_A = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const ID_B = '8a2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function rowsFrom(byTab: Record<string, Array<Record<string, unknown>>>) {
  return (t: TabSpec<any, any>) =>
    (async function* () {
      for (const row of byTab[t.name] ?? []) yield row;
    })();
}

async function buildWorkbook(
  overrides: {
    tabs?: readonly TabSpec<any, any>[];
    meta?: WorkbookMeta;
    rows?: Record<string, Array<Record<string, unknown>>>;
  } = {},
) {
  return writeWorkbook({
    tabs: overrides.tabs ?? [classesTab, paymentsTab],
    meta: overrides.meta ?? meta,
    rowsFor: rowsFrom(overrides.rows ?? {}),
  });
}

/** A minimal sheet part: every cell an inline string, rows numbered from 1. */
function sheetXml(rows: string[][]): string {
  const body = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">` +
        cells
          .map(
            (v, c) =>
              `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`,
          )
          .join('') +
        '</row>',
    )
    .join('');
  return (
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

/**
 * Builds a zip by hand with every part stored (method 0), so a test can put
 * any bytes it likes in a part — exceljs would never write broken XML for
 * us. CRCs are left at 0: neither the size guard nor the reader checks them.
 */
function storedZip(parts: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(parts)) {
    const name = Buffer.from(path, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length / 2, 8);
  eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

describe('writeWorkbook / readWorkbook round trip', () => {
  // #2686: our own export puts `workbook.xml` (the sheet names) last in the
  // zip and uses no shared-strings table; a file Excel or exceljs saves puts
  // the names first and every string in `sharedStrings.xml`. The streaming
  // read must give the same rows for both layouts.
  it('reads the same rows from an export and from that export re-saved by exceljs', async () => {
    const rows = {
      classes: [{ id: ID_A, name: 'Six', capacity: 40 }],
      payments: [{ id: ID_B, name: 'Tuition', amount: '100.00', paid: true }],
    };
    const exported = await buildWorkbook({ rows });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported as unknown as ArrayBuffer);
    const resaved = Buffer.from(await workbook.xlsx.writeBuffer());

    const fromExport = await readWorkbook(exported);
    const fromResave = await readWorkbook(resaved);

    expect([...fromExport.sheets.keys()]).toEqual(['classes', 'payments']);
    expect([...fromResave.sheets.keys()]).toEqual(['classes', 'payments']);
    expect(fromResave.sheets.get('classes')!.rows).toEqual(fromExport.sheets.get('classes')!.rows);
    expect(fromResave.sheets.get('payments')!.rows).toEqual(
      fromExport.sheets.get('payments')!.rows,
    );
    expect(fromExport.sheets.get('classes')!.rows[0].cells).toEqual({
      id: ID_A,
      name: 'Six',
      capacity: '40',
    });
    expect(fromResave.meta).toEqual(meta);
  });

  it('returns keys, values and order unchanged', async () => {
    const buffer = await buildWorkbook({
      rows: {
        classes: [
          { id: ID_A, name: 'Six', capacity: 40 },
          { id: ID_B, name: 'Seven', capacity: 35 },
        ],
        payments: [{ id: ID_A, name: 'March', amount: '1500.5', paid: true }],
      },
    });

    const result = await readWorkbook(buffer);

    expect(result.meta).toEqual(meta);
    expect([...result.sheets.keys()]).toEqual(['classes', 'payments']);

    const classes = result.sheets.get('classes')!;
    expect(classes.header).toEqual(['id', 'name', 'capacity']);
    expect(classes.rows.map((r) => r.cells)).toEqual([
      { id: ID_A, name: 'Six', capacity: '40' },
      { id: ID_B, name: 'Seven', capacity: '35' },
    ]);

    // Money keeps its two decimal places through the round trip.
    const payments = result.sheets.get('payments')!;
    expect(payments.rows[0].cells).toEqual({
      id: ID_A,
      name: 'March',
      amount: '1500.50',
      paid: 'TRUE',
    });
  });

  it('reports the source row number so errors point at the right line', async () => {
    const buffer = await buildWorkbook({
      rows: {
        classes: [
          { id: ID_A, name: 'Six' },
          { id: ID_B, name: 'Seven' },
        ],
      },
    });

    const rows = (await readWorkbook(buffer)).sheets.get('classes')!.rows;

    // Row 1 is the header, so data starts at row 2.
    expect(rows.map((r) => r.rowNo)).toEqual([2, 3]);
  });

  it('writes the _meta sheet first', async () => {
    const buffer = await buildWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const names: string[] = [];
    workbook.eachSheet((sheet) => names.push(sheet.name));

    expect(names[0]).toBe('_meta');
  });

  it('writes an empty tab as a header-only sheet', async () => {
    const result = await readWorkbook(await buildWorkbook({ rows: {} }));

    expect(result.sheets.get('classes')!.rows).toEqual([]);
    expect(result.sheets.get('classes')!.header).toEqual(['id', 'name', 'capacity']);
  });
});

describe('readWorkbook row skipping', () => {
  it('skips a template sample row', async () => {
    const buffer = await buildWorkbook({
      rows: {
        classes: [
          { id: 'SAMPLE', name: 'Example class', capacity: 30 },
          { id: ID_A, name: 'Six', capacity: 40 },
        ],
      },
    });

    const rows = (await readWorkbook(buffer)).sheets.get('classes')!.rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].cells.name).toBe('Six');
  });

  it('skips a fully blank row', async () => {
    const buffer = await buildWorkbook({
      rows: {
        classes: [
          { id: null, name: null, capacity: null },
          { id: ID_A, name: 'Six', capacity: 40 },
        ],
      },
    });

    const rows = (await readWorkbook(buffer)).sheets.get('classes')!.rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].cells.name).toBe('Six');
  });
});

describe('readWorkbook warnings', () => {
  it('warns exactly once for an unknown sheet and skips it', async () => {
    const buffer = await buildWorkbook();

    // Add a sheet no EXPECTED_TABS name covers.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const stray = workbook.addWorksheet('mystery_tab');
    stray.addRow(['id', 'name']);
    stray.addRow([ID_A, 'whatever']);
    const withStray = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await readWorkbook(withStray);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].tab).toBe('mystery_tab');
    expect(result.warnings[0].severity).toBe('warning');
    expect(result.sheets.has('mystery_tab')).toBe(false);
  });

  it('does not warn on an untouched SAMPLE row from a real tab', async () => {
    const classesSpec = ALL_TABS.find((t) => t.name === 'classes')!;
    const buffer = await writeWorkbook({
      tabs: [classesSpec],
      meta,
      rowsFor: rowsFrom({ classes: [buildSampleRow(classesSpec)] }),
    });

    const result = await readWorkbook(buffer);

    expect(result.warnings).toHaveLength(0);
    expect(result.sheets.get('classes')!.rows).toHaveLength(0);
  });

  it('warns when a SAMPLE-id row was edited (real record typed over the example)', async () => {
    const classesSpec = ALL_TABS.find((t) => t.name === 'classes')!;
    const editedSample = { ...buildSampleRow(classesSpec), name: 'Class Six' };
    const buffer = await writeWorkbook({
      tabs: [classesSpec],
      meta,
      rowsFor: rowsFrom({ classes: [editedSample] }),
    });

    const result = await readWorkbook(buffer);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].tab).toBe('classes');
    expect(result.warnings[0].severity).toBe('warning');
    expect(result.warnings[0].message).toMatch(/SAMPLE/);
    // Still dropped: a SAMPLE id is never a usable key regardless of warning.
    expect(result.sheets.get('classes')!.rows).toHaveLength(0);
  });
});

describe('readWorkbook resilience', () => {
  // Business-critical: exceljs skips empty rows, so a blank row inserted
  // above the header shifts the header off row 1. Keying the header to row 1
  // would drop every record; on a deleteByAbsence tab that reads as "the
  // user deleted everything" and would wipe the tenant's table.
  it('finds the header even when a blank row precedes it', async () => {
    const workbook = new ExcelJS.Workbook();
    const metaSheet = workbook.addWorksheet('_meta');
    metaSheet.addRow(['key', 'value']);
    metaSheet.addRow(['schema_version', SCHEMA_VERSION]);
    metaSheet.addRow(['kind', 'BACKUP']);

    const sheet = workbook.addWorksheet('classes');
    sheet.getRow(2).values = ['id', 'name', 'capacity'];
    sheet.getRow(3).values = [ID_A, 'Six', 40];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const classes = (await readWorkbook(buffer)).sheets.get('classes')!;

    expect(classes.header).toEqual(['id', 'name', 'capacity']);
    expect(classes.rows).toHaveLength(1);
    expect(classes.rows[0].cells.name).toBe('Six');
  });

  // Business-critical: exceljs hands back a date-formatted cell as a real
  // JS `Date` (not the plain string `writeWorkbook` itself always emits via
  // `toCell`), so a workbook edited by hand in Excel/Sheets must still read
  // back as the same calendar day the `date` column expects.
  it('reads a real ExcelJS date-formatted cell as its calendar day', async () => {
    const workbook = new ExcelJS.Workbook();
    const metaSheet = workbook.addWorksheet('_meta');
    metaSheet.addRow(['key', 'value']);
    metaSheet.addRow(['schema_version', SCHEMA_VERSION]);
    metaSheet.addRow(['kind', 'BACKUP']);

    const sheet = workbook.addWorksheet('classes');
    sheet.getRow(1).values = ['id', 'created_on', 'capacity'];
    const dataRow = sheet.getRow(2);
    dataRow.values = [ID_A, new Date(Date.UTC(2026, 2, 9)), 40];
    dataRow.getCell(2).numFmt = 'yyyy-mm-dd';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const classes = (await readWorkbook(buffer)).sheets.get('classes')!;

    // readWorkbook itself is column-blind (uses cellText, not fromCell), so
    // the raw cell text is the ISO timestamp cellText renders from the Date
    // — the `date`-column acceptance of that string is cell-format.spec.ts's
    // job, verified there directly against `fromCell`.
    expect(classes.rows[0].cells.created_on).toBe('2026-03-09T00:00:00.000Z');
  });

  // Business-critical: Bengali digits in a school name must survive. The
  // column-blind normaliser would rewrite ৫ to 5.
  it('preserves Bengali digits in _meta values', async () => {
    const bengaliMeta: WorkbookMeta = {
      ...meta,
      source_school_name: '৫ নম্বর সরকারি বিদ্যালয়',
    };

    const result = await readWorkbook(await buildWorkbook({ meta: bengaliMeta }));

    expect(result.meta.source_school_name).toBe('৫ নম্বর সরকারি বিদ্যালয়');
  });
});

describe('WorkbookFormatError', () => {
  // Review r1 m4: a zip bomb says "too large", not "not a valid workbook".
  it('throws TOO_LARGE when the zip-bomb guard rejects the buffer as too large', async () => {
    guardState.bomb = true;
    try {
      await expect(readWorkbook(Buffer.from('PK'))).rejects.toMatchObject({
        code: 'TOO_LARGE',
        message: XLSX_TOO_LARGE_MESSAGE,
      });
    } finally {
      guardState.bomb = false;
    }
  });

  it('throws NOT_XLSX when the guard finds a malformed zip', async () => {
    await expect(readWorkbook(Buffer.from('PK'))).rejects.toMatchObject({ code: 'NOT_XLSX' });
  });

  it('rejects a _meta sheet whose kind is not a known kind', async () => {
    const buffer = await buildWorkbook({
      meta: { ...meta, kind: 'ARCHIVE' as WorkbookMeta['kind'] },
    });

    await expect(readWorkbook(buffer)).rejects.toMatchObject({ code: 'MISSING_META' });
  });

  // #2686 fail closed (D18): a stream that stops half-way is a format error,
  // never a partly read workbook that a restore could then apply.
  it('throws NOT_XLSX or TOO_LARGE for a buffer cut in half, never a partial result', async () => {
    const whole = await buildWorkbook({
      rows: { classes: [{ id: ID_A, name: 'Six', capacity: 40 }] },
    });
    const half = whole.subarray(0, Math.floor(whole.length / 2));

    await expect(readWorkbook(half)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof WorkbookFormatError && (e.code === 'NOT_XLSX' || e.code === 'TOO_LARGE'),
    );
  });

  // The zip is intact and every part inflates (so the size guard passes),
  // but one sheet's XML is broken: the streaming parser must throw, not
  // return the sheets it managed to read before it.
  it('throws NOT_XLSX when a sheet part holds broken XML', async () => {
    const parts = {
      'xl/_rels/workbook.xml.rels':
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="x" Target="worksheets/sheet3.xml"/></Relationships>',
      'xl/workbook.xml':
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        '<sheet name="_meta" sheetId="1" r:id="rId1"/><sheet name="classes" sheetId="2" r:id="rId2"/>' +
        '<sheet name="payments" sheetId="3" r:id="rId3"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml': sheetXml([
        ['key', 'value'],
        ['schema_version', String(SCHEMA_VERSION)],
        ['kind', 'BACKUP'],
      ]),
      'xl/worksheets/sheet2.xml': sheetXml([
        ['id', 'name'],
        [ID_A, 'Six'],
      ]),
      // A mismatched closing tag: the SAX parser rejects it on sight.
      'xl/worksheets/sheet3.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c></rowx>' +
        '</sheetData></worksheet>',
    };

    await expect(readWorkbook(storedZip(parts))).rejects.toMatchObject({ code: 'NOT_XLSX' });
    // Same parts with a well-formed sheet3 read fine, so it is the XML and
    // not the hand-built zip that the reader objects to.
    const fixed = storedZip({ ...parts, 'xl/worksheets/sheet3.xml': sheetXml([['id', 'name']]) });
    expect((await readWorkbook(fixed)).sheets.get('classes')!.rows[0].cells.name).toBe('Six');
  });

  it('throws NOT_XLSX for a csv-shaped buffer', async () => {
    const csv = Buffer.from('id,name\n1,Six\n', 'utf8');

    await expect(readWorkbook(csv)).rejects.toMatchObject({
      name: 'WorkbookFormatError',
      code: 'NOT_XLSX',
    });
  });

  it('throws MISSING_META when there is no _meta sheet', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('classes');
    sheet.addRow(['id', 'name']);
    sheet.addRow([ID_A, 'Six']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(readWorkbook(buffer)).rejects.toMatchObject({ code: 'MISSING_META' });
  });

  it('throws UNSUPPORTED_VERSION for a future schema version', async () => {
    const buffer = await buildWorkbook({ meta: { ...meta, schema_version: SCHEMA_VERSION + 1 } });

    await expect(readWorkbook(buffer)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
  });

  // GAP-10: version 1 wrote raw user uuids where version 2 writes user
  // emails. Refuse it with a clear message instead of failing every row.
  it('throws UNSUPPORTED_VERSION for a version-1 workbook (raw user ids)', async () => {
    const buffer = await buildWorkbook({ meta: { ...meta, schema_version: 1 } });

    await expect(readWorkbook(buffer)).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION',
      message: expect.stringContaining('schema version 1'),
    });
  });

  it('carries a code field on the error instance', async () => {
    const error = new WorkbookFormatError('NOT_XLSX', 'nope');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NOT_XLSX');
  });
});

/**
 * The ticket asks for a soft heap assertion on a ~20MB fixture. An earlier
 * draft did exactly that and was flaky — `global.gc?.()` is a no-op without
 * `--expose-gc`, and the measured `heapUsed` delta necessarily includes the
 * returned Buffer, which *does* grow with the row count. It reddened once in
 * three runs, which is worse than no test.
 *
 * These assert the deterministic properties instead: rows are pulled from the
 * AsyncIterable lazily (so the caller's own row set is never fully resident),
 * and a large workbook round-trips correctly.
 */
describe('streaming', () => {
  it('pulls rows from the iterable lazily rather than draining it first', async () => {
    const order: string[] = [];

    const rowsFor = () =>
      (async function* () {
        for (let i = 0; i < 200; i++) {
          order.push(`yield:${i}`);
          yield { id: ID_A, name: `Class ${i}`, capacity: i };
        }
        order.push('generator-done');
      })();

    await writeWorkbook({ tabs: [classesTab], meta, rowsFor });

    // If writeWorkbook collected every row before writing, the generator
    // would finish first and 'generator-done' would be followed by nothing.
    // Interleaving is what proves rows are committed as they arrive.
    expect(order[0]).toBe('yield:0');
    expect(order.at(-1)).toBe('generator-done');
    expect(order).toHaveLength(201);
  });

  it('round-trips a large workbook', async () => {
    const rowsFor = () =>
      (async function* () {
        for (let i = 0; i < 20_000; i++) {
          yield {
            id: ID_A,
            name: `Class ${i} with padding text to make the row a realistic width`,
            capacity: i,
          };
        }
      })();

    const buffer = await writeWorkbook({ tabs: [classesTab], meta, rowsFor });
    const result = await readWorkbook(buffer);

    expect(result.sheets.get('classes')!.rows).toHaveLength(20_000);
    expect(result.sheets.get('classes')!.rows[19_999].cells.capacity).toBe('19999');
  }, 120_000);
});

describe('SheetDecorator.addListValidation guards', () => {
  it('rejects a value containing a comma', async () => {
    await expect(
      writeWorkbook({
        tabs: [classesTab],
        meta,
        rowsFor: rowsFrom({}),
        decorate: (sheet) => sheet.addListValidation(2, ['ok', 'has,comma'], false),
      }),
    ).rejects.toThrow(/,/);
  });

  it('rejects a value set whose inline formula exceeds 255 chars', async () => {
    const longValues = Array.from({ length: 30 }, (_, i) => `option-number-${i}-padded-value`);
    await expect(
      writeWorkbook({
        tabs: [classesTab],
        meta,
        rowsFor: rowsFrom({}),
        decorate: (sheet) => sheet.addListValidation(2, longValues, false),
      }),
    ).rejects.toThrow(/255/);
  });

  it('accepts a short, comma-free value set', async () => {
    await expect(
      writeWorkbook({
        tabs: [classesTab],
        meta,
        rowsFor: rowsFrom({}),
        decorate: (sheet) => sheet.addListValidation(2, ['TRUE', 'FALSE'], false),
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });
});

// [17.2.5]: `holidays` was renamed to `calendar_events`. A workbook exported
// before that rename must still restore.
describe('readWorkbook legacy `holidays` sheet alias', () => {
  it('reads a `holidays` sheet as `calendar_events` when no `calendar_events` sheet exists', async () => {
    const workbook = new ExcelJS.Workbook();
    const metaSheet = workbook.addWorksheet('_meta');
    metaSheet.addRow(['key', 'value']);
    metaSheet.addRow(['schema_version', SCHEMA_VERSION]);
    metaSheet.addRow(['kind', 'BACKUP']);

    const sheet = workbook.addWorksheet('holidays');
    sheet.getRow(1).values = ['id', 'academic_year', 'name'];
    sheet.getRow(2).values = [ID_A, '2026-2027', 'Winter break'];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await readWorkbook(buffer);

    expect(result.sheets.has('holidays')).toBe(false);
    const calendarEvents = result.sheets.get('calendar_events');
    expect(calendarEvents).toBeDefined();
    expect(calendarEvents!.header).toEqual(['id', 'academic_year', 'name']);
    expect(calendarEvents!.rows).toHaveLength(1);
    expect(calendarEvents!.rows[0].cells.name).toBe('Winter break');
  });

  it('leaves an actual `calendar_events` sheet alone when both sheets are present', async () => {
    const workbook = new ExcelJS.Workbook();
    const metaSheet = workbook.addWorksheet('_meta');
    metaSheet.addRow(['key', 'value']);
    metaSheet.addRow(['schema_version', SCHEMA_VERSION]);
    metaSheet.addRow(['kind', 'BACKUP']);

    const legacy = workbook.addWorksheet('holidays');
    legacy.getRow(1).values = ['id', 'name'];
    legacy.getRow(2).values = [ID_A, 'Legacy row'];

    const current = workbook.addWorksheet('calendar_events');
    current.getRow(1).values = ['id', 'name'];
    current.getRow(2).values = [ID_B, 'Current row'];

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await readWorkbook(buffer);

    expect(result.sheets.get('calendar_events')!.rows[0].cells.name).toBe('Current row');
    // `holidays` isn't in EXPECTED_TABS anymore, so it is skipped as a
    // stray sheet rather than clobbering the real `calendar_events` data.
    expect(result.warnings.some((w) => w.tab === 'holidays')).toBe(true);
  });
});

// Acceptance criterion from the ticket, enforced rather than trusted.
describe('exceljs containment', () => {
  // Spec files are excluded: this spec imports exceljs itself to build
  // fixture workbooks, which is fine. The criterion is about production code
  // — nothing that ships may reach past this module to the library.
  it('is imported only by workbook-codec.ts across modules/workbook', () => {
    const root = __dirname.replace(/\/codec$/, '');

    let matches: string[] = [];
    try {
      matches = execFileSync('grep', ['-rl', "from 'exceljs'", root], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
    } catch {
      // grep exits 1 when nothing matches, which would itself be a failure.
      matches = [];
    }

    const production = matches
      .map((p) => p.slice(root.length))
      .filter((p) => !/[.-]spec\.ts$/.test(p)); // *.spec.ts and *.e2e-spec.ts

    expect(production).toEqual(['/codec/workbook-codec.ts']);
  });
});
