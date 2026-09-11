import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { cellText, normalizeCell, toCell } from './cell-format';
import { META_FIELDS, META_SHEET, SCHEMA_VERSION, type WorkbookMeta } from './meta';
import { EXPECTED_TABS } from './registry';
import type { RowError, TabSpec } from './tab-spec';

/**
 * The only module under `modules/workbook/` that imports `exceljs`.
 *
 * Keeping the spreadsheet library behind these two functions means the rest
 * of the backup feature deals in plain records and never in cell objects, and
 * that replacing exceljs later is a one-file change.
 * `workbook-codec.spec.ts` enforces the exclusivity by scanning the tree.
 *
 * ### Known asymmetry: writing streams, reading does not
 *
 * `writeWorkbook` commits rows as they arrive, so no tab's full row set is
 * resident. `readWorkbook` cannot match that — the signature takes a
 * `Buffer` and exceljs's `xlsx.load` materialises the whole workbook object
 * model, which runs several times the file size in heap. That is acceptable
 * for the file sizes this feature targets, but a restore of a very large
 * backup is the place to look first if the API container runs out of memory.
 * Moving to `exceljs`'s streaming reader would mean changing this signature,
 * so it is deliberately left for whoever needs it.
 */

export type WorkbookFormatErrorCode = 'NOT_XLSX' | 'MISSING_META' | 'UNSUPPORTED_VERSION';

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

export interface WriteWorkbookInput {
  tabs: readonly TabSpec<any, any>[];
  meta: WorkbookMeta;
  rowsFor: (tab: TabSpec<any, any>) => AsyncIterable<Record<string, unknown>>;
}

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
export async function writeWorkbook({ tabs, meta, rowsFor }: WriteWorkbookInput): Promise<Buffer> {
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

  for (const tab of tabs) {
    const sheet = workbook.addWorksheet(tab.name);
    sheet.addRow(tab.columns.map((c) => c.key)).commit();

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

/** Template sample rows carry this literal in their id cell (epic D12). */
const SAMPLE_ROW_ID = 'SAMPLE';

const KINDS = new Set<WorkbookMeta['kind']>(['BACKUP', 'SNAPSHOT', 'TEMPLATE']);

export async function readWorkbook(buffer: Buffer): Promise<ReadWorkbookResult> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (cause) {
    throw new WorkbookFormatError(
      'NOT_XLSX',
      'This file is not a valid .xlsx workbook. Export a backup from Biddaloy and upload that file.',
      { cause },
    );
  }

  const warnings: RowError[] = [];
  const meta = readMeta(workbook);
  const known = new Set<string>(EXPECTED_TABS);
  const sheets = new Map<string, SheetData>();

  workbook.eachSheet((worksheet) => {
    const name = worksheet.name;
    if (name === META_SHEET) return;

    if (!known.has(name)) {
      // Skipped, not fatal: a workbook written by a newer schema may carry a
      // sheet this version has never heard of, and that must not make the
      // rest of the backup unreadable.
      warnings.push({
        tab: name,
        row: 0,
        column: null,
        message: `Sheet "${name}" is not a known tab and was ignored.`,
        severity: 'warning',
      });
      return;
    }

    sheets.set(name, readSheet(worksheet, name, warnings));
  });

  return { meta, sheets, warnings };
}

function readMeta(workbook: ExcelJS.Workbook): WorkbookMeta {
  const sheet = workbook.getWorksheet(META_SHEET);
  if (!sheet) {
    throw new WorkbookFormatError(
      'MISSING_META',
      `This workbook has no "${META_SHEET}" sheet, so it cannot be identified as a Biddaloy backup.`,
    );
  }

  const values: Record<string, string> = {};
  sheet.eachRow((row, rowNo) => {
    if (rowNo === 1) return; // header: key | value
    // Keys are normalised (they are ASCII identifiers), but values are read
    // as plain text: `normalizeCell` would rewrite Bengali digits in a
    // school name, turning `৫ নম্বর সরকারি বিদ্যালয়` into
    // `5 নম্বর সরকারি বিদ্যালয়` and corrupting the provenance shown to the
    // user at restore time.
    const key = normalizeCell(row.getCell(1).value);
    if (key !== '') values[key] = cellText(row.getCell(2).value);
  });

  const version = Number(values.schema_version);
  if (!Number.isInteger(version) || version !== SCHEMA_VERSION) {
    throw new WorkbookFormatError(
      'UNSUPPORTED_VERSION',
      `This workbook uses schema version ${values.schema_version ?? '(missing)'}, but this ` +
        `version of Biddaloy reads version ${SCHEMA_VERSION}.`,
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

function readSheet(worksheet: ExcelJS.Worksheet, name: string, warnings: RowError[]): SheetData {
  let header: string[] = [];
  let headerSeen = false;
  const rows: SheetData['rows'] = [];

  worksheet.eachRow((row, rowNo) => {
    // The header is the first row `eachRow` actually yields, not row 1.
    // exceljs skips empty rows entirely, so if a user inserts a blank row
    // above the header in Excel — routine — the first yielded rowNo is 2.
    // Keying on `rowNo === 1` would then consume the real header as data,
    // leave `header` empty, and drop every row as blank; for a tab with
    // `deleteByAbsence` that reads as "no records" and would delete the
    // tenant's entire table.
    if (!headerSeen) {
      headerSeen = true;
      header = readRowValues(row).map((v) => normalizeCell(v));
      return;
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
    if (blank) return;

    // Template sample rows exist to show the expected shape and must never
    // be imported as real data.
    if (cells.id === SAMPLE_ROW_ID) return;

    rows.push({ rowNo, cells });
  });

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
