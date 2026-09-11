/**
 * The `_meta` sheet: what a workbook is, where it came from, and which
 * version of this codec wrote it.
 *
 * It is the first sheet in every workbook and is two columns wide — `key`
 * then `value`, one row per field — so it stays readable to a human opening
 * the file in Excel and trivially parseable without knowing the schema.
 *
 * ```
 * | key                | value                    |
 * | schema_version     | 1                        |
 * | kind               | BACKUP                   |
 * | exported_at        | 2026-03-09T22:00:00.000Z |
 * | app_version        | 1.14.0                   |
 * | source_school_name | Dhaka Model High School  |
 * | source_school_slug | dhaka-model              |
 * ```
 */

/**
 * Bumped only when a change would make an older workbook unreadable.
 * `readWorkbook` refuses any other value rather than guessing.
 */
export const SCHEMA_VERSION = 1;

export interface WorkbookMeta {
  schema_version: number;
  kind: 'BACKUP' | 'SNAPSHOT' | 'TEMPLATE';
  exported_at: string;
  app_version: string;
  source_school_name: string;
  source_school_slug: string;
}

/** Sheet name of the metadata sheet. Not a tab, so never in EXPECTED_TABS. */
export const META_SHEET = '_meta';

/** Field order used when writing the `_meta` sheet. */
export const META_FIELDS = [
  'schema_version',
  'kind',
  'exported_at',
  'app_version',
  'source_school_name',
  'source_school_slug',
] as const satisfies readonly (keyof WorkbookMeta)[];
