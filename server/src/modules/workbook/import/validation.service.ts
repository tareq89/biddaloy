import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { readWorkbook } from '../codec/workbook-codec';
import { KeyIndex } from '../codec/key-index';
import { ALL_TABS } from '../codec/registry';
import type { ImportContext, RowError, TabSpec } from '../codec/tab-spec';
import type { ValidatedTab, ValidatedWorkbook } from './validated-workbook';

/** Per-workbook cap on stored errors, so one catastrophic sheet cannot blow up memory or the response payload. */
const MAX_STORED_ERRORS = 1000;

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

    for (const tab of tabSpecs) {
      const existingEntities = await tab.load(tenantId, manager);
      existingIndexes.set(tab.name, KeyIndex.fromEntities(tab, existingEntities));
      pendingIndexes.set(tab.name, new Map<string, string>());

      const tabErrors: RowError[] = [];
      const tabWarnings: RowError[] = [];
      const rows: unknown[] = [];

      const sheet = sheets.get(tab.name);
      if (!sheet) {
        const w: RowError = {
          tab: tab.name,
          row: 0,
          column: null,
          severity: 'warning',
          message: `sheet ${tab.name} not present — its rows are left unchanged`,
        };
        tabWarnings.push(w);
        warnings.push(w);
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
        tabWarnings.push(w);
        warnings.push(w);
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
          const pending = pendingIndexes.get(t)?.get(key);
          if (pending !== undefined) return pending;
          return existingIndexes.get(t)?.get(key);
        },
        warn: (e: RowError): void => {
          tabWarnings.push(e);
          warnings.push(e);
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
        pendingIndexes.get(tab.name)!.set(key, `pending:${tab.name}:${key}`);
      }

      tabs[tab.name] = { present: true, rows, errors: tabErrors, warnings: tabWarnings };
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
