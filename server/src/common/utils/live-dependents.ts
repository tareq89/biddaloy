import { ConflictException } from '@nestjs/common';
import type { EntityManager, ObjectLiteral } from 'typeorm';

/**
 * [2675-2680] Counts live rows (soft-deleted ones, and ones whose other parent
 * is soft-deleted, are skipped) of every entity that has a many-to-one to `parent` pointing at `parentId`, and
 * throws 409 when there are any. Read off the TypeORM metadata so a relation
 * added later is guarded too (it is also listed in test/delete-guard-registry.ts).
 *
 * `exclude` holds "Child.relationProperty" keys that the caller counts or
 * cascades itself. The parent id is already tenant-checked by the caller.
 * Errors name counts only, never the submitted value (Rule 23).
 */
export async function assertNoLiveDependents(
  manager: EntityManager,
  parent: new () => ObjectLiteral,
  parentId: string,
  opts: { code: string; message: string; exclude?: string[] },
): Promise<void> {
  const dependents: Record<string, number> = {};
  for (const meta of manager.connection.entityMetadatas) {
    for (const rel of meta.manyToOneRelations) {
      if (rel.inverseEntityMetadata.target !== parent) continue;
      if (opts.exclude?.includes(`${meta.name}.${rel.propertyName}`)) continue;
      // [2703 M4] Soft-deleted rows are skipped (main alias), and so is a row whose
      // own other parent is soft-deleted: it went with that parent and nobody can
      // reach it to remove it. The join adds `deleted_at IS NULL` to its ON clause.
      // Identifiers below come from entity metadata, never from input.
      const qb = manager
        .createQueryBuilder(meta.target as new () => ObjectLiteral, 'c')
        .where(`c.${rel.joinColumns[0].databaseName} = :parentId`, { parentId });
      meta.manyToOneRelations.forEach((other, i) => {
        const otherMeta = other.inverseEntityMetadata;
        if (other === rel || !otherMeta.deleteDateColumn) return;
        const fk = other.joinColumns[0].databaseName;
        const pk = otherMeta.primaryColumns[0].databaseName;
        qb.leftJoin(`c.${other.propertyName}`, `p${i}`).andWhere(
          `(c.${fk} IS NULL OR p${i}.${pk} IS NOT NULL)`,
        );
      });
      const n = await qb.getCount();
      if (n > 0) dependents[meta.name] = (dependents[meta.name] ?? 0) + n;
    }
  }
  if (Object.keys(dependents).length > 0) {
    throw new ConflictException({
      message: opts.message,
      details: { code: opts.code, dependents },
    });
  }
}
