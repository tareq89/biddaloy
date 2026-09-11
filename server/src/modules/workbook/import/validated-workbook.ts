import type { RowError } from '../codec/tab-spec';
import type { WorkbookMeta } from '../codec/meta';

/**
 * The result of validating one tab's sheet against its `TabSpec`.
 *
 * `rows` holds only the rows that parsed cleanly and passed the duplicate-key
 * check; a row rejected for either reason contributes to `errors` instead and
 * is absent here, so nothing downstream (the diff engine in 14.8.2) ever has
 * to re-check validity.
 */
export interface ValidatedTab {
  /**
   * False when the workbook has no sheet for this tab at all. A tab that is
   * present but empty (header row only) is still `true` with `rows: []` —
   * the distinction matters because an absent tab must not be treated as
   * "delete every row", while an empty one may be.
   */
  present: boolean;
  rows: unknown[];
  errors: RowError[];
  warnings: RowError[];
}

/**
 * A workbook after `ValidationService.validate` has parsed, type-checked, and
 * resolved cross-tab references — but written nothing.
 *
 * `errors`/`warnings` are the flattened union of every tab's, in `ALL_TABS`
 * order, for callers (the validate endpoint, tests) that want one list
 * without walking `tabs`. `hardErrorCount` mirrors `errors.filter(e =>
 * e.severity === 'error').length` for the *actual* total, which can exceed
 * `errors.length` once the 1,000-error cap has kicked in.
 */
export interface ValidatedWorkbook {
  meta: WorkbookMeta;
  tabs: Record<string, ValidatedTab>;
  errors: RowError[];
  warnings: RowError[];
  hardErrorCount: number;
}
