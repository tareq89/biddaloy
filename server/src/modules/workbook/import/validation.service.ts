import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { readWorkbook } from '../codec/workbook-codec';
import { KeyIndex } from '../codec/key-index';
import { ALL_TABS } from '../codec/registry';
import type { ImportContext, RowError, TabSpec } from '../codec/tab-spec';
import type { ValidatedTab, ValidatedWorkbook } from './validated-workbook';

/** Per-workbook cap on stored errors, so one catastrophic sheet cannot blow up memory or the response payload. */
const MAX_STORED_ERRORS = 1000;

/** The same cap for warnings. A `TabSpec.fromRow` that warns per row (the
 * weak-key notice in `payments.tab.ts`, for one) would otherwise grow these
 * arrays without bound on a 50k-row sheet — the exact thing MAX_STORED_ERRORS
 * exists to prevent, just via the other list. */
const MAX_STORED_WARNINGS = 1000;

/**
 * Turns an uploaded workbook into typed rows plus a precise error list,
 * without writing anything.
 *
 * This is the read half of import: it loads each tab's existing rows only to
 * build the `KeyIndex` that resolves natural-key references (`ctx.ref`), and
 * never calls `upsert`/`remove`/`save`. The diff (14.8.2) and the actual
 * write (14.9+) are separate services precisely so this one stays a pure,
 * side-effect-free "is this workbook well-formed" check that can run inside a
 * request without risking partial writes.
 */
@Injectable()
export class ValidationService {
  async validate(
    buffer: Buffer,
    tenantId: string,
    manager: EntityManager,
    // Overridable only so tests can exercise this against a small fake
    // registry instead of the real 18-tab one; production callers never pass
    // this.
    tabSpecs: readonly TabSpec<any, any>[] = ALL_TABS,
  ): Promise<ValidatedWorkbook> {
    const { meta, sheets, warnings: readWarnings } = await readWorkbook(buffer);

    const errors: RowError[] = [];
    const warnings: RowError[] = [...readWarnings];
    const tabs: Record<string, ValidatedTab> = {};

    // Existing rows, one KeyIndex per tab, so `ctx.ref` can resolve a natural
    // key against the destination's current data.
    const existingIndexes = new Map<string, KeyIndex>();
    // Rows accepted earlier in *this* workbook, so a tab can reference a row
    // from an earlier tab in the same upload before anything is written.
    const pendingIndexes = new Map<string, Map<string, string>>();

    let totalErrorCount = 0;
    let storedErrorCount = 0;
    let totalWarningCount = 0;
    let storedWarningCount = 0;

    // Caps *both* the flattened `errors` list and each tab's own `errors`
    // list against the same budget, so a single catastrophic sheet cannot
    // blow up memory or the response payload — capping only the flattened
    // list would leave `tabs[tab].errors` unbounded.
    const recordError = (target: RowError[], e: RowError): void => {
      if (e.severity === 'error') {
        totalErrorCount++;
        if (storedErrorCount >= MAX_STORED_ERRORS) return;
        storedErrorCount++;
      }
      target.push(e);
      if (e.severity === 'error') errors.push(e);
    };

    const recordWarning = (target: RowError[], w: RowError): void => {
      totalWarningCount++;
      if (storedWarningCount >= MAX_STORED_WARNINGS) return;
      storedWarningCount++;
      target.push(w);
      warnings.push(w);
    };

    for (const tab of tabSpecs) {
      const existingEntities = await tab.load(tenantId, manager);
      existingIndexes.set(tab.name, KeyIndex.fromEntities(tab, existingEntities));
      pendingIndexes.set(tab.name, new Map<string, string>());

      const tabErrors: RowError[] = [];
      const tabWarnings: RowError[] = [];
      const rows: unknown[] = [];
      // Referenced natural keys that match more than one row in the
      // destination, collected by `ctx.ref` below and reported once per
      // distinct key after the sheet is walked — `ref` has no row number,
      // and the per-row "not found" error it triggers would otherwise be the
      // only signal, which names the wrong cause.
      const ambiguousRefs: Array<{ tab: string; key: string }> = [];

      const sheet = sheets.get(tab.name);
      if (!sheet) {
        const w: RowError = {
          tab: tab.name,
          row: 0,
          column: null,
          severity: 'warning',
          message: `sheet ${tab.name} not present — its rows are left unchanged`,
        };
        recordWarning(tabWarnings, w);
        tabs[tab.name] = { present: false, rows: [], errors: [], warnings: tabWarnings };
        continue;
      }

      const knownColumns = new Set(tab.columns.map((c) => c.key));
      const missingRequired = tab.columns
        .filter((c) => c.required && !sheet.header.includes(c.key))
        .map((c) => c.key);
      const unknownColumns = sheet.header.filter((h) => !knownColumns.has(h));

      for (const column of unknownColumns) {
        const w: RowError = {
          tab: tab.name,
          row: 0,
          column,
          severity: 'warning',
          message: `Unknown column "${column}" in sheet "${tab.name}" was ignored.`,
        };
        recordWarning(tabWarnings, w);
      }

      if (missingRequired.length > 0) {
        const e: RowError = {
          tab: tab.name,
          row: 0,
          column: null,
          severity: 'error',
          message: `Sheet "${tab.name}" is missing required column(s): ${missingRequired.join(', ')}.`,
        };
        recordError(tabErrors, e);
        tabs[tab.name] = { present: true, rows: [], errors: tabErrors, warnings: tabWarnings };
        continue;
      }

      const ctx: ImportContext = {
        tenantId,
        ref: (t: string, key: string): string | undefined => {
          const existingIndex = existingIndexes.get(t);

          // A natural key that resolves to two different rows cannot be
          // resolved by guessing — that is exactly what `KeyIndex` records
          // ambiguity for (see codec/key-index.ts). Binding silently to
          // whichever row was indexed first is last-write-wins on someone's
          // real data, so report it and let the row fail instead.
          if (existingIndex?.isAmbiguous(key)) {
            ambiguousRefs.push({ tab: t, key });
            return undefined;
          }

          // The destination's real id wins over this workbook's placeholder.
          // A key present in both means the restore will update that row in
          // place, so the referencing row must carry the row's actual uuid —
          // returning `pending:<tab>:<key>` instead made DiffService compare
          // a synthetic string against the stored uuid and report a change,
          // bucketing essentially every row carrying a foreign key as an
          // `update` with a bogus changed field.
          const existing = existingIndex?.get(key);
          if (existing !== undefined) return existing;

          // Only rows that do not exist yet need a placeholder; the restore
          // executor (14.10) resolves these once it has inserted them.
          return pendingIndexes.get(t)?.get(key);
        },
        warn: (e: RowError): void => {
          recordWarning(tabWarnings, e);
        },
      };

      // Rows accepted so far in this sheet, keyed by their natural key, so a
      // duplicate can be detected and both offending rows can be reported and
      // excluded.
      // The first accepted row for each key, kept even after a duplicate is
      // found (unlike a plain "seen" set that gets deleted on first clash) so
      // a *third* row with the same key is still recognised as another
      // duplicate rather than silently accepted as a fresh row.
      const firstByKey = new Map<string, { rowNo: number; row: unknown }>();
      const duplicateKeys = new Set<string>();

      for (const { rowNo, cells } of sheet.rows) {
        const result = tab.fromRow(cells, rowNo, ctx);
        if ('errors' in result) {
          for (const e of result.errors) recordError(tabErrors, e);
          continue;
        }

        const key = tab.keyOf(result.row);
        const first = firstByKey.get(key);
        if (first) {
          if (!duplicateKeys.has(key)) {
            duplicateKeys.add(key);
            recordError(tabErrors, {
              tab: tab.name,
              row: first.rowNo,
              column: null,
              severity: 'error',
              message: `Duplicate key "${key}" in sheet "${tab.name}" is also used by row ${rowNo}.`,
            });
            const idx = rows.indexOf(first.row);
            if (idx >= 0) rows.splice(idx, 1);
            pendingIndexes.get(tab.name)!.delete(key);
          }
          recordError(tabErrors, {
            tab: tab.name,
            row: rowNo,
            column: null,
            severity: 'error',
            message: `Duplicate key "${key}" in sheet "${tab.name}" is also used by row ${first.rowNo}.`,
          });
          continue;
        }

        firstByKey.set(key, { rowNo, row: result.row });
        rows.push(result.row);
        // Only a key the destination does not already carry needs a
        // placeholder — see `ctx.ref` above, which prefers the real id.
        if (!existingIndexes.get(tab.name)?.get(key)) {
          pendingIndexes.get(tab.name)!.set(key, `pending:${tab.name}:${key}`);
        }
      }

      for (const { tab: refTab, key } of dedupeRefs(ambiguousRefs)) {
        recordError(tabErrors, {
          tab: tab.name,
          row: 0,
          column: null,
          severity: 'error',
          message: `Sheet "${tab.name}" references "${key}" in "${refTab}", but more than one ${refTab} row has that key — rename them so each is unique, or set the id column.`,
          value: key,
        });
      }

      tabs[tab.name] = { present: true, rows, errors: tabErrors, warnings: tabWarnings };
    }

    if (totalWarningCount > storedWarningCount) {
      warnings.push({
        tab: '*',
        row: 0,
        column: null,
        severity: 'warning',
        message: `…and ${totalWarningCount - storedWarningCount} more warning(s) were found but not shown.`,
      });
    }

    if (totalErrorCount > errors.length) {
      warnings.push({
        tab: '*',
        row: 0,
        column: null,
        severity: 'warning',
        message: `…and ${totalErrorCount - errors.length} more error(s) were found but not shown.`,
      });
    }

    return { meta, tabs, errors, warnings, hardErrorCount: totalErrorCount };
  }
}

/** One entry per distinct (tab, key) pair, preserving first-seen order. */
function dedupeRefs(
  refs: Array<{ tab: string; key: string }>,
): Array<{ tab: string; key: string }> {
  const seen = new Set<string>();
  return refs.filter(({ tab, key }) => {
    const id = `${tab}\u0000${key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
