import type { EntityManager, EntityTarget } from 'typeorm';

/**
 * The contract every workbook tab implements.
 *
 * A "tab" is one sheet in a backup workbook: the mapping between a TypeORM
 * entity and a rectangle of cells. Everything the export/import engine needs
 * to know about an entity lives behind this interface, so the engine itself
 * never mentions a concrete entity.
 *
 * Lanes 14.2-14.4 each add tabs in their own `tabs/<group>/` directory and
 * register them through that group's barrel file, so no two lanes edit the
 * same file.
 */

export type ColumnType =
  | 'uuid'
  | 'string'
  | 'int'
  | 'money'
  | 'date'
  | 'datetime'
  | 'bool'
  | 'enum'
  | 'json'
  | 'ref'
  | 'ref-list';

export interface ColumnSpec {
  key: string;
  type: ColumnType;
  required?: boolean;
  /**
   * Actor columns (author, creator) that may be blank because the export
   * blanks a departed user. Blank on an existing row keeps the stored actor;
   * blank on a row that does not exist yet is a validation error.
   */
  requiredOnNewRow?: boolean;
  enumValues?: readonly string[];
  ref?: string;
  label: { en: string; bn: string };
}

/**
 * One problem with one cell (or one row, when `column` is null). Both export
 * and import collect these rather than throwing, so a single bad row never
 * costs the user the other 4,000 good ones.
 */
export interface RowError {
  tab: string;
  row: number;
  column: string | null;
  message: string;
  severity: 'error' | 'warning';
  value?: string;
}

/** Resolves a foreign entity id to the natural key written into the cell. */
export interface ExportContext {
  keyOf(tab: string, id: string): string;
  /**
   * Like `keyOf`, but null when the id is not in that tab's export instead of
   * throwing. For nullable attribution columns whose user may be departed or
   * a SUPER_ADMIN (neither is in the `users` tab). Absent in simple test
   * doubles; use `optionalKeyOf`.
   */
  tryKeyOf?(tab: string, id: string): string | null;
}

/** `ctx.tryKeyOf` when the context has one, else strict `keyOf`. */
export function optionalKeyOf(ctx: ExportContext, tab: string, id: string): string | null {
  return ctx.tryKeyOf ? ctx.tryKeyOf(tab, id) : ctx.keyOf(tab, id);
}

/** Resolves a natural key read from a cell back to a local entity id. */
export interface ImportContext {
  tenantId: string;
  ref(tab: string, key: string): string | undefined;
  warn(e: RowError): void;
}

/**
 * @typeParam E - the TypeORM entity this tab exports.
 * @typeParam R - the validated, in-memory row shape `fromRow` produces and
 *   `upsert` consumes. Deliberately distinct from `E`: a row holds resolved
 *   foreign ids and primitives, not a live entity instance.
 */
export interface TabSpec<E, R> {
  name: string; // sheet name, snake_case
  entity: EntityTarget<E>; // for the completeness gate (14.1.4)
  excluded: readonly string[]; // entity columns deliberately not exported, each with a `//` reason
  dependsOn: readonly string[]; // tab names that must be applied first
  columns: readonly ColumnSpec[]; // columns[0] is always { key: 'id', type: 'uuid' }
  naturalKey: readonly string[]; // column keys, joined with '|' by keyOf
  deleteByAbsence: boolean;
  /** Opt-in only for a tab with no DB unique constraint on `naturalKey` and
   * no other tab referencing it by that key ([23.0]'s 7 staff-child
   * tables) — real data can carry two rows with the same natural key
   * (e.g. two trainings titled the same). `ValidationService` normally
   * hard-rejects a duplicate key; this lets it accept one instead, when
   * each conflicting row is either already the destination's existing
   * entity (by id) or the key doesn't exist in the destination at all. */
  allowDuplicateKeys?: boolean;
  load(tenantId: string, m: EntityManager): Promise<E[]>;
  toRow(entity: E, ctx: ExportContext): Record<string, unknown>;
  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: R } | { errors: RowError[] };
  keyOf(x: R | E): string;
  /**
   * Optional second uniqueness rule that the natural key cannot express (e.g.
   * "one CLASS_TEACHER per section"). Return null when the rule does not
   * apply. `ValidationService` rejects two rows of one file that share a
   * non-null value, and, for a TEMPLATE workbook (which may never delete),
   * a row whose value is already held by a different row in the destination.
   */
  secondaryKeyOf?(x: R | E): string | null;
  diffFields(row: R, existing: E): string[];
  /** `actorUserId`: the user running the restore, for a NOT NULL attribution
   * column the file left blank on a new row (`promotion_runs.created_by`). */
  upsert(
    row: R,
    existing: E | null,
    tenantId: string,
    m: EntityManager,
    actorUserId?: string | null,
  ): Promise<E>;
  remove(entity: E, m: EntityManager): Promise<void>;
  /**
   * Optional: the refusals the app applies to deleting these rows, for the
   * rows a BACKUP restore would remove because the file leaves them out
   * (`deleteByAbsence`). `ValidationService` turns each message into an
   * error, so the restore stops before anything is written.
   */
  checkRemove?(absent: E[], tenantId: string, m: EntityManager): Promise<string[]>;
}
