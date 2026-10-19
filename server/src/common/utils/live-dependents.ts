import { ConflictException } from '@nestjs/common';
import type { EntityManager, ObjectLiteral } from 'typeorm';

/**
 * [2675-2680] Counts live rows (soft-deleted ones are skipped by `count`) of
 * every entity that has a many-to-one to `parent` pointing at `parentId`, and
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
      const n = await manager.count(meta.target as new () => ObjectLiteral, {
        where: { [rel.propertyName]: { id: parentId } },
      });
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
