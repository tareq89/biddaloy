import { PassThrough, Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { Logger } from '@nestjs/common';
import {
  assertXlsxWithinLimits,
  XLSX_TOO_LARGE_MESSAGE,
  XlsxTooLargeError,
} from '../../../common/utils/xlsx-guard.util';
import ExcelJS from 'exceljs';
import { BACKUP_MAX_ENTRIES, BACKUP_MAX_INFLATED_BYTES } from '../export/export.constants';
import { cellText, normalizeCell, toCell } from './cell-format';
import { META_FIELDS, META_SHEET, SCHEMA_VERSION, type WorkbookMeta } from './meta';
import { ALL_TABS, EXPECTED_TABS } from './registry';
import type { ColumnSpec, RowError, TabSpec } from './tab-spec';

/**
 * The only module under `modules/workbook/` that imports `exceljs`.
 *
 * Keeping the spreadsheet library behind these two functions means the rest
 * of the backup feature deals in plain records and never in cell objects, and
 * that replacing exceljs later is a one-file change.
 * `workbook-codec.spec.ts` enforces the exclusivity by scanning the tree.
 *
 * ### Both directions stream
 *
 * `writeWorkbook` commits rows as they arrive, so no tab's full row set is
 * resident. `readWorkbook` (#2686) streams too: each sheet's XML is inflated
 * straight out of the zipped buffer and parsed row by row, so the only
 * things resident besides the upload itself are the plain `SheetData` rows
 * it returns, never exceljs's whole workbook object model.
 *
 * It does *not* use exceljs's `WorkbookReader` zip walk. That walk reads the
 * archive in file order and spills a sheet to a temp file when it arrives
 * before `sharedStrings.xml`; and `unzipper` (exceljs 4.4.0's zip parser)
 * re-emits `end` the moment it reaches the central directory, while entries
 * are still queued unread — so the walk silently drops whatever parts come
 * last. In our own exports `workbook.xml` (the sheet names) is last. Instead,
 * {@link openXlsx} reads the zip's central directory itself (stdlib `zlib`),
 * parses the four bookkeeping parts first through exceljs's own part
 * parsers, and then streams each sheet by name. The parsers it calls are
 * exceljs internals pinned by `workbook-codec.spec.ts`'s round-trip cases.
 */

export type WorkbookFormatErrorCode =
  'NOT_XLSX' | 'TOO_LARGE' | 'MISSING_META' | 'UNSUPPORTED_VERSION';

/**
 * A workbook that cannot be read at all. Distinct from a `RowError`: this is
 * a broken or incompatible *file*, not a bad row, so it aborts the read
 * rather than being collected.
 */
export class WorkbookFormatError extends Error {
  readonly code: WorkbookFormatErrorCode;

  constructor(code: WorkbookFormatErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkbookFormatError';
    this.code = code;
  }
}

/**
 * A tab's sheet, decoration-only. Never exposes a raw exceljs cell or row —
 * `TemplateService` (the only caller) must stay on the plain-records side of
 * the boundary this module's own doc comment describes, same as every other
 * caller of `writeWorkbook`.
 */
export interface SheetDecorator {
  /**
   * Adds a dropdown (`list` data validation) over that column's data rows
   * (rows 2 through {@link TEMPLATE_VALIDATED_ROWS}). `columnIndex` is
   * 1-based, matching `tab.columns`' own order.
   */
  addListValidation(columnIndex: number, values: readonly string[], allowBlank: boolean): void;
  /** Sets a comment on that column's header cell (row 1). 1-based. */
  setHeaderNote(columnIndex: number, note: string): void;
}

/** Data validation only covers this many data rows — a template is meant to
 * be filled by hand or a small import, not thousands of rows at once. */
const TEMPLATE_VALIDATED_ROWS = 1000;

/** exceljs's public types don't declare `Worksheet.dataValidations` (it is
 * real at runtime — see `node_modules/exceljs/lib/doc/data-validations.js` —
 * just missing from `index.d.ts`), so this narrows the cast to one place. */
interface WorksheetWithValidations extends ExcelJS.Worksheet {
  dataValidations: { add(address: string, validation: ExcelJS.DataValidation): void };
}

/** `1 -> 'A'`, `27 -> 'AA'`. exceljs has no public export for this. */
function columnLetter(oneBasedIndex: number): string {
  let n = oneBasedIndex;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Excel's inline `formulae: ['"a,b,c"']` list-validation form caps the whole
 * quoted string at 255 characters and uses `,` as the item separator, so a
 * value containing a comma or a long-enough value set would silently
 * corrupt the dropdown (Excel truncates or splits it wrong) rather than
 * error. Guarded here instead of trusting every future enum to stay short
 * and comma-free. */
const INLINE_LIST_VALIDATION_MAX_CHARS = 255;

function makeDecorator(sheet: ExcelJS.Worksheet, headerRow: ExcelJS.Row): SheetDecorator {
  return {
    addListValidation(columnIndex, values, allowBlank) {
      if (values.some((v) => v.includes(','))) {
        throw new Error(`List validation values cannot contain ",": ${JSON.stringify(values)}`);
      }
      const formula = `"${values.join(',')}"`;
      if (formula.length > INLINE_LIST_VALIDATION_MAX_CHARS) {
        throw new Error(
          `List validation formula exceeds Excel's ${INLINE_LIST_VALIDATION_MAX_CHARS}-char ` +
            `inline limit (${formula.length} chars): ${JSON.stringify(values)}`,
        );
      }
      const letter = columnLetter(columnIndex);
      (sheet as WorksheetWithValidations).dataValidations.add(
        `${letter}2:${letter}${TEMPLATE_VALIDATED_ROWS}`,
        { type: 'list', allowBlank, formulae: [formula], showErrorMessage: true },
      );
    },
    setHeaderNote(columnIndex, note) {
      headerRow.getCell(columnIndex).note = note;
    },
  };
}

export interface WriteWorkbookInput {
  tabs: readonly TabSpec<any, any>[];
  meta: WorkbookMeta;
  rowsFor: (tab: TabSpec<any, any>) => AsyncIterable<Record<string, unknown>>;
  /**
   * Optional: called once per tab immediately after its sheet and header row
   * are created, before either is committed. Lets a caller (`TemplateService`)
   * add dropdowns and header comments without this module knowing anything
   * about templates, and without the caller ever touching an exceljs cell.
   */
  decorate?: (sheet: SheetDecorator, tab: TabSpec<any, any>) => void;
  /**
   * Optional: rows for a `_readme` sheet, written immediately after `_meta`
   * and before the first tab. Plain rows, written as-is — no formatting.
   */
  readme?: readonly (string | number)[][];
}

/** Sheet name of the template fill-instructions sheet (14.13.1). Not a tab
 * (never in `EXPECTED_TABS`) and, like `META_SHEET`, silently skipped by
 * `readWorkbook` rather than warned about as a stray sheet — it is part of
 * the template format, not foreign data. */
export const README_SHEET = '_readme';

/**
 * Writes the `_meta` sheet followed by one sheet per tab, in the given order.
 *
 * Row 1 of each tab sheet is exactly `tab.columns.map(c => c.key)`; data
 * starts at row 2. Values arrive from `rowsFor` as the plain records
 * `TabSpec.toRow` produces, and this function applies `toCell` per column —
 * so `cell-format.ts` stays the single formatting authority rather than every
 * caller repeating it.
 *
 * Rows are streamed and committed as they arrive, so no tab's full row set is
 * ever resident. The finished bytes are collected into one Buffer at the end
 * because that is what the signature promises.
 */
export async function writeWorkbook({
  tabs,
  meta,
  rowsFor,
  decorate,
  readme,
}: WriteWorkbookInput): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  // If exceljs errors mid-write, both `workbook.commit()` and `finished`
  // reject. The commit rejection propagates out of this function before
  // anything awaits `finished`, leaving it unhandled — which terminates the
  // Node process by default, turning one bad export into an API outage.
  finished.catch(() => undefined);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: false });

  const metaSheet = workbook.addWorksheet(META_SHEET);
  metaSheet.addRow(['key', 'value']).commit();
  for (const field of META_FIELDS) {
    metaSheet.addRow([field, meta[field]]).commit();
  }
  metaSheet.commit();

  if (readme) {
    const readmeSheet = workbook.addWorksheet(README_SHEET);
    for (const row of readme) readmeSheet.addRow(row).commit();
    readmeSheet.commit();
  }

  for (const tab of tabs) {
    const sheet = workbook.addWorksheet(tab.name);
    const headerRow = sheet.addRow(tab.columns.map((c) => c.key));
    if (decorate) decorate(makeDecorator(sheet, headerRow), tab);
    headerRow.commit();

    for await (const row of rowsFor(tab)) {
      sheet.addRow(tab.columns.map((c) => toCell(c.type, row[c.key]))).commit();
    }

    sheet.commit();
  }

  await workbook.commit();
  await finished;

  return Buffer.concat(chunks);
}

export interface SheetData {
  header: string[];
  rows: Array<{ rowNo: number; cells: Record<string, string> }>;
}

export interface ReadWorkbookResult {
  meta: WorkbookMeta;
  sheets: Map<string, SheetData>;
  warnings: RowError[];
}

/** Template sample rows carry this literal in their id cell (epic D12).
 * Exported so `TemplateService` (which must never import `exceljs` itself)
 * can build a sample row using the exact same literal this module skips
 * on read, instead of duplicating the string. */
export const SAMPLE_ROW_ID = 'SAMPLE';

/**
 * A value for `col` that looks right to a human and round-trips through
 * `toCell`. Never re-validated on import: a row whose `id` cell is
 * `SAMPLE` is skipped before `fromRow`/`fromCell` ever see it, so these
 * values only have to be *legible*, not strictly valid. Lang-independent —
 * `string` uses the English label on purpose, so the same shipped values
 * can be checked for on read regardless of which `lang` a template was
 * downloaded in (see {@link sampleRowMatchesShipped}).
 */
function sampleValue(col: ColumnSpec): unknown {
  switch (col.type) {
    case 'uuid':
      return SAMPLE_ROW_ID;
    case 'int':
      return 1;
    case 'money':
      return '100.00';
    case 'date':
      return '2026-01-01';
    case 'datetime':
      return '2026-01-01T00:00:00.000Z';
    case 'bool':
      return true;
    case 'enum':
      return col.enumValues?.[0] ?? '';
    case 'json':
      return {};
    case 'ref':
      return `(sample ${col.ref} row)`;
    case 'ref-list':
      return [`(sample ${col.ref} row)`];
    case 'string':
    default:
      return `Sample ${col.label.en}`;
  }
}

/** Builds the exact row `TemplateService` writes for `tab`'s one sample
 * row. Lives here, not in `template.service.ts`, so `readWorkbook` can
 * check a `SAMPLE`-id row's cells against the same values without either
 * module importing the other (`template.service.ts` already imports this
 * module). */
export function buildSampleRow(tab: TabSpec<any, any>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of tab.columns) {
    row[col.key] = col.key === 'id' ? SAMPLE_ROW_ID : sampleValue(col);
  }
  return row;
}

/**
 * True when every non-`id` cell in a `SAMPLE`-id row still holds exactly
 * what `buildSampleRow` shipped — i.e. the user never touched the row.
 * Compares against `cellText`, the same untyped read `readSheet` already
 * did for `cells`, so this needs no column-type-aware parsing.
 */
function sampleRowMatchesShipped(tab: TabSpec<any, any>, cells: Record<string, string>): boolean {
  const shipped = buildSampleRow(tab);
  return tab.columns.every((col) => {
    if (col.key === 'id') return true;
    const expected = toCell(col.type, shipped[col.key]);
    const expectedText = expected === null ? '' : String(expected);
    return (cells[col.key] ?? '') === expectedText;
  });
}

const KINDS = new Set<WorkbookMeta['kind']>(['BACKUP', 'SNAPSHOT', 'TEMPLATE']);

/**
 * Legacy sheet names, mapped to the current tab name that reads them.
 *
 * [17.2.5] renamed the `holidays` tab to `calendar_events` (it now exports
 * the full `CalendarEvent` shape, not just the holiday-shaped subset). A
 * workbook exported before that rename still has a `holidays` sheet; this
 * alias lets `readWorkbook` hand that sheet's rows to `calendarEventsTab`
 * so an old backup keeps restoring instead of the sheet being skipped as
 * "not a known tab".
 */
const LEGACY_SHEET_ALIASES: Readonly<Record<string, string>> = {
  holidays: 'calendar_events',
};

const readWorkbookLogger = new Logger('readWorkbook');

const NOT_XLSX_MESSAGE =
  'This file is not a valid .xlsx workbook. Export a backup from SchoolManager and upload that file.';

export async function readWorkbook(buffer: Buffer): Promise<ReadWorkbookResult> {
  const warnings: RowError[] = [];
  const sheets = new Map<string, SheetData>();

  try {
    // Whole-school backup: limits are shared with the upload cap and the
    // export-time warning (export.constants.ts).
    await assertXlsxWithinLimits(buffer, {
      maxUncompressedBytes: BACKUP_MAX_INFLATED_BYTES,
      maxEntries: BACKUP_MAX_ENTRIES,
    });
    const xlsx = await openXlsx(buffer);

    if (!xlsx.sheetNames.includes(META_SHEET)) {
      throw new WorkbookFormatError(
        'MISSING_META',
        `This workbook has no "${META_SHEET}" sheet, so it cannot be identified as a SchoolManager backup.`,
      );
    }
    // Meta first, whatever the sheet order: an unsupported version is
    // refused before any data sheet is inflated.
    const meta = await readMeta(xlsx.rows(META_SHEET));
    const known = new Set<string>(EXPECTED_TABS);
    const presentSheetNames = new Set<string>(xlsx.sheetNames);

    for (const originalName of xlsx.sheetNames) {
      if (originalName === META_SHEET || originalName === README_SHEET) continue;

      // A legacy sheet name is only aliased when the workbook has no sheet
      // already using the current name — a backup never carries both
      // `holidays` and `calendar_events`, but this guard keeps the current
      // sheet authoritative if it somehow did.
      const aliasTarget = LEGACY_SHEET_ALIASES[originalName];
      const name = aliasTarget && !presentSheetNames.has(aliasTarget) ? aliasTarget : originalName;

      if (name !== originalName) {
        readWorkbookLogger.log(
          `Restoring legacy sheet "${originalName}" as "${name}" (${originalName} was renamed in [17.2.5]).`,
        );
      }

      if (!known.has(name)) {
        // Skipped, not fatal: a workbook written by a newer schema may carry a
        // sheet this version has never heard of, and that must not make the
        // rest of the backup unreadable. Skipped before it is inflated, too.
        warnings.push({
          tab: name,
          row: 0,
          column: null,
          message: `Sheet "${name}" is not a known tab and was ignored.`,
          severity: 'warning',
        });
        continue;
      }

      const tab = ALL_TABS.find((t) => t.name === name);
      sheets.set(name, await readSheet(xlsx.rows(originalName), name, warnings, tab));
    }

    return { meta, sheets, warnings };
  } catch (cause) {
    if (cause instanceof WorkbookFormatError) throw cause;
    if (cause instanceof XlsxTooLargeError) {
      throw new WorkbookFormatError('TOO_LARGE', XLSX_TOO_LARGE_MESSAGE, { cause });
    }
    // Fail closed (D18): a broken part, a sheet the zip does not carry, an
    // inflate error mid-sheet — the caller never sees a partly read workbook.
    throw new WorkbookFormatError('NOT_XLSX', NOT_XLSX_MESSAGE, { cause });
  }
}

// ---------------------------------------------------------------------------
// Streaming read of one .xlsx buffer (see the module doc comment for why this
// does not use exceljs's own `WorkbookReader` zip walk).
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;

interface ZipEntry {
  method: number;
  dataStart: number;
  compressedSize: number;
}

/**
 * Walks the central directory and returns every entry by path. Structure
 * errors throw a plain `Error` (mapped to `NOT_XLSX` by the caller);
 * `assertXlsxWithinLimits` has already inflated every entry against the
 * size budget, so nothing here is trusted for size — only for position.
 */
function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG)
      throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const path = buf.toString('utf8', p + 46, p + 46 + nameLength);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOC_SIG)
      throw new Error('Bad zip entry');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + compressedSize > buf.length) throw new Error('Bad zip entry');
    entries.set(path, { method, dataStart, compressedSize });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The entry's inflated bytes as a stream. Nothing is copied: the deflated
 * slice is a view of the upload and inflates in 16 KB chunks. */
function entryStream(buf: Buffer, entry: ZipEntry): Readable {
  const deflated = Readable.from([
    buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize),
  ]);
  if (entry.method === ZIP_STORED) return deflated;
  if (entry.method !== ZIP_DEFLATED) throw new Error(`Unsupported zip method ${entry.method}`);
  return deflated.pipe(createInflateRaw());
}

/** exceljs's `WorkbookReader` part parsers. Undeclared in `index.d.ts`, real
 * in `node_modules/exceljs/lib/stream/xlsx/workbook-reader.js`; the shapes of
 * `model.sheets` and `workbookRels` come from `sheet-xform.js` and
 * `relationships-xform.js`. Narrowed to one place, same as
 * `WorksheetWithValidations` above. */
interface WorkbookReaderInternals {
  model?: { sheets?: Array<{ name: string; rId: string }> };
  workbookRels?: Array<{ Id: string; Target: string }>;
  _parseRels(entry: Readable): Promise<void>;
  _parseWorkbook(entry: Readable): Promise<void>;
  _parseSharedStrings(entry: Readable): AsyncIterable<unknown>;
  _parseStyles(entry: Readable): Promise<void>;
  _parseWorksheet(
    iterator: Readable,
    sheetNo: string,
  ): Iterable<{ eventType: string; value: AsyncIterable<ExcelJS.Row> }>;
}

interface OpenedXlsx {
  /** Every sheet `xl/workbook.xml` declares, in workbook order. */
  sheetNames: string[];
  /** Streams that sheet's rows. Throws if the zip has no part for it. */
  rows(sheetName: string): AsyncIterable<ExcelJS.Row>;
}

/**
 * Parses the bookkeeping parts (`workbook.xml`, its rels, shared strings,
 * styles) once, then lets the caller stream any sheet by name. `styles` is
 * cached on purpose: without it a real Excel date cell comes back as a
 * serial number instead of a `Date`.
 */
async function openXlsx(buffer: Buffer): Promise<OpenedXlsx> {
  const entries = zipEntries(buffer);
  const part = (path: string): Readable | undefined => {
    const entry = entries.get(path);
    return entry && entryStream(buffer, entry);
  };

  // The input stream is never read: every part is fed to the parsers below.
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(new PassThrough(), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    entries: 'ignore',
  }) as unknown as WorkbookReaderInternals;

  const rels = part('xl/_rels/workbook.xml.rels');
  const workbook = part('xl/workbook.xml');
  if (!rels || !workbook) throw new Error('Not an xlsx: workbook part missing');
  await reader._parseRels(rels);
  await reader._parseWorkbook(workbook);
  const sharedStrings = part('xl/sharedStrings.xml');
  if (sharedStrings) for await (const _ of reader._parseSharedStrings(sharedStrings)) void _;
  const styles = part('xl/styles.xml');
  if (styles) await reader._parseStyles(styles);

  const relsById = new Map((reader.workbookRels ?? []).map((r) => [r.Id, r.Target]));
  const partBySheet = new Map<string, string>();
  for (const sheet of reader.model?.sheets ?? []) {
    const target = relsById.get(sheet.rId);
    if (!target) throw new Error(`Not an xlsx: sheet "${sheet.name}" has no part`);
    // Targets are relative to `xl/` ("worksheets/sheet1.xml"), or absolute
    // ("/xl/worksheets/sheet1.xml") from some writers.
    partBySheet.set(sheet.name, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }

  return {
    sheetNames: [...partBySheet.keys()],
    rows(sheetName) {
      const path = partBySheet.get(sheetName);
      const stream = path && part(path);
      if (!stream) throw new Error(`Not an xlsx: sheet part missing`);
      const sheetNo = /sheet(\d+)\.xml$/.exec(path)?.[1] ?? '0';
      for (const { value } of reader._parseWorksheet(stream, sheetNo)) return value;
      throw new Error('Not an xlsx: sheet part unreadable');
    },
  };
}

async function readMeta(rows: AsyncIterable<ExcelJS.Row>): Promise<WorkbookMeta> {
  const values: Record<string, string> = {};
  for await (const row of rows) {
    if (row.number === 1) continue; // header: key | value
    // Keys are normalised (they are ASCII identifiers), but values are read
    // as plain text: `normalizeCell` would rewrite Bengali digits in a
    // school name, turning `৫ নম্বর সরকারি বিদ্যালয়` into
    // `5 নম্বর সরকারি বিদ্যালয়` and corrupting the provenance shown to the
    // user at restore time.
    const key = normalizeCell(row.getCell(1).value);
    if (key !== '') values[key] = cellText(row.getCell(2).value);
  }

  const version = Number(values.schema_version);
  if (!Number.isInteger(version) || version !== SCHEMA_VERSION) {
    throw new WorkbookFormatError(
      'UNSUPPORTED_VERSION',
      `This workbook uses schema version ${values.schema_version ?? '(missing)'}, but this ` +
        `version of SchoolManager reads version ${SCHEMA_VERSION}.`,
    );
  }

  // Validated against the union rather than cast: a blank or misspelled
  // `kind` would otherwise be typed as one of the three values while
  // matching none of them, so every downstream `kind === 'TEMPLATE'` check
  // would silently fall through.
  const kind = values.kind as WorkbookMeta['kind'];
  if (!KINDS.has(kind)) {
    throw new WorkbookFormatError(
      'MISSING_META',
      `The "${META_SHEET}" sheet has kind "${values.kind ?? '(missing)'}", which is not one of ` +
        `${[...KINDS].join(', ')}.`,
    );
  }

  return {
    schema_version: version,
    kind,
    exported_at: values.exported_at ?? '',
    app_version: values.app_version ?? '',
    source_school_name: values.source_school_name ?? '',
    source_school_slug: values.source_school_slug ?? '',
  };
}

async function readSheet(
  sheetRows: AsyncIterable<ExcelJS.Row>,
  name: string,
  warnings: RowError[],
  tab: TabSpec<any, any> | undefined,
): Promise<SheetData> {
  let header: string[] = [];
  let headerSeen = false;
  const rows: SheetData['rows'] = [];

  for await (const row of sheetRows) {
    const rowNo = row.number;
    // The header is the first row the stream actually yields, not row 1.
    // exceljs skips empty rows entirely, so if a user inserts a blank row
    // above the header in Excel — routine — the first yielded rowNo is 2.
    // Keying on `rowNo === 1` would then consume the real header as data,
    // leave `header` empty, and drop every row as blank; for a tab with
    // `deleteByAbsence` that reads as "no records" and would delete the
    // tenant's entire table.
    if (!headerSeen) {
      headerSeen = true;
      header = readRowValues(row).map((v) => normalizeCell(v));
      continue;
    }

    const values = readRowValues(row);
    const cells: Record<string, string> = {};
    let blank = true;

    header.forEach((key, index) => {
      if (key === '') return;
      // `cellText`, not `normalizeCell`: the column type is not known here,
      // and `normalizeCell` would map Bengali digits to ASCII and collapse
      // whitespace in every cell — corrupting a Bangla school name and
      // flattening a multi-line address. `fromCell` applies both, but only
      // for the numeric and date column types where they are meaningful.
      const text = cellText(values[index]);
      cells[key] = text;
      if (text !== '') blank = false;
    });

    // A blank row is spreadsheet noise (a user pressing enter), not a record.
    if (blank) continue;

    // Template sample rows exist to show the expected shape and must never
    // be imported as real data.
    if (cells.id === SAMPLE_ROW_ID) {
      // If a shipped sample row's other cells no longer match what
      // `buildSampleRow` wrote, the user most likely typed a real record
      // straight over the example row and left the `id` cell untouched —
      // that row is still dropped (its `id` isn't a usable key), but
      // silently is wrong: only `totals.creates` would come back lower,
      // with nothing telling the user why.
      if (tab && !sampleRowMatchesShipped(tab, cells)) {
        warnings.push({
          tab: name,
          row: rowNo,
          column: null,
          message:
            `Row ${rowNo} has "id" = "${SAMPLE_ROW_ID}" but its other cells were edited — this ` +
            `row was not imported. If this was meant to be a real record, give it a fresh id ` +
            `and re-upload.`,
          severity: 'warning',
        });
      }
      continue;
    }

    rows.push({ rowNo, cells });
  }

  if (header.length === 0) {
    // `severity: 'error'`, not a warning: a known tab with no header is a
    // broken sheet, and the import engine must not read the resulting zero
    // rows as "the user deleted everything" on a deleteByAbsence tab.
    warnings.push({
      tab: name,
      row: 0,
      column: null,
      message: `Sheet "${name}" has no header row, so none of its rows could be read.`,
      severity: 'error',
    });
  }

  return { header, rows };
}

/**
 * exceljs's `row.values` is 1-based with a hole at index 0; this returns a
 * plain 0-based array so callers can zip it against the header.
 */
function readRowValues(row: ExcelJS.Row): unknown[] {
  const values = row.values;
  if (Array.isArray(values)) return values.slice(1);
  return [];
}
