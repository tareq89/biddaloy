import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/**
 * Share-locks (`FOR SHARE`) the live, tenant-owned parent rows a writer is about to point a child
 * row at, inside the writer's transaction, and returns how many were found.
 *
 * A delete guard locks the parent `FOR UPDATE`, counts its dependents and soft-deletes. A writer
 * that reads the parent without a lock can insert after that count and before the commit, leaving
 * a child on a deleted parent. With this lock the delete waits for the writer (and then counts the
 * new row), or the writer runs after the delete and finds nothing (#2715).
 * The caller compares the count with the number of ids it asked for and answers its own 404/400.
 */
export async function shareLockLive<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  ids: string[],
  tenantId: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await manager
    .createQueryBuilder(entity, 'p')
    .setLock('pessimistic_read')
    .where('p.tenant_id = :tenantId AND p.id IN (:...ids) AND p.deleted_at IS NULL', {
      tenantId,
      ids,
    })
    .select('p.id')
    .getMany();
  return rows.length;
}
