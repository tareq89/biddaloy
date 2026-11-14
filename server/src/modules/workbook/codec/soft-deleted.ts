import type { EntityManager } from 'typeorm';
import type { TabSpec } from './tab-spec';

/** Table, soft-delete column and tenant column of a tab's entity, or null when the entity is not
 * both tenant-scoped and soft-deleted (then there is nothing to revive). */
function softDeleteTarget(tab: TabSpec<any, any>, m: EntityManager) {
  if (!m.connection?.hasMetadata(tab.entity)) return null; // test doubles have no schema
  const meta = m.connection.getMetadata(tab.entity);
  const deleted = meta.deleteDateColumn;
  const tenant = meta.findColumnWithPropertyName('tenant_id');
  const id = meta.findColumnWithPropertyName('id');
  if (!deleted || !tenant || !id) return null;
  return { table: meta.tableName, deleted: deleted.databaseName, tenant: tenant.databaseName };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idsOf = (rows: readonly unknown[]): string[] =>
  rows
    .map((r) => (r as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && UUID.test(id));

/**
 * [#688] Ids from the workbook's rows that name a soft-deleted row of this school. A backup
 * restore removes rows by soft delete, so the same file restored again must bring the row back
 * (revive), not insert a duplicate or hit a unique constraint. Matched by id only: the key of a
 * row read without the tab's relations is not reliable. Read only.
 */
export async function softDeletedRowIds(
  tab: TabSpec<any, any>,
  rows: readonly unknown[],
  tenantId: string,
  m: EntityManager,
): Promise<Set<string>> {
  const target = softDeleteTarget(tab, m);
  const ids = idsOf(rows);
  if (!target || ids.length === 0) return new Set();
  const found: { id: string }[] = await m.query(
    `SELECT id FROM "${target.table}"
      WHERE "${target.tenant}" = $1 AND id = ANY($2::uuid[]) AND "${target.deleted}" IS NOT NULL`,
    [tenantId, ids],
  );
  return new Set(found.map((r) => r.id));
}

/** Clears `deleted_at` on those rows; returns how many came back. */
export async function reviveRows(
  tab: TabSpec<any, any>,
  ids: ReadonlySet<string>,
  tenantId: string,
  m: EntityManager,
): Promise<number> {
  const target = softDeleteTarget(tab, m);
  if (!target || ids.size === 0) return 0;
  const [, count]: [unknown, number] = await m.query(
    `UPDATE "${target.table}" SET "${target.deleted}" = NULL
      WHERE "${target.tenant}" = $1 AND id = ANY($2::uuid[]) AND "${target.deleted}" IS NOT NULL`,
    [tenantId, [...ids]],
  );
  return count;
}
