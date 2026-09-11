import type { RowError } from '../codec/tab-spec';

/** Row counts, shared by a single tab's diff and by the workbook-wide totals. */
export interface DiffCounts {
  creates: number;
  updates: number;
  unchanged: number;
  deletes: number;
}

/** First few keys of each bucket, so a preview UI can show "e.g. Karim, Rahim, …" without shipping every row. */
export interface DiffSamples {
  creates: string[];
  updates: string[];
  deletes: string[];
}

export interface TabDiff extends DiffCounts {
  name: string;
  present: boolean;
  /** Histogram of changed field names across every `updates` row, e.g. `{ phone: 3, class: 1 }`. */
  changedFields: Record<string, number>;
  errors: RowError[];
  warnings: RowError[];
  samples: DiffSamples;
}

/**
 * The dry-run numbers an admin confirms before a restore actually writes
 * anything. Produced by `DiffService.diff` from an already-`ValidatedWorkbook`
 * — this stage only reads and compares, it never touches the database.
 */
export interface DiffReport {
  tabs: TabDiff[];
  totals: DiffCounts;
  hardErrorCount: number;
  /**
   * True when every present tab except `school` has zero existing rows —
   * the signal a "first import into a brand-new tenant" UI uses to skip the
   * update/delete warnings that only matter for a restore into data that
   * already exists.
   */
  isEmptyTenant: boolean;
}
