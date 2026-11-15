import type { EntityManager } from 'typeorm';
import type { TabSpec } from './tab-spec';

/**
 * [#2761] `load()` joins relations, `upsert()` then sets only the FK column, and on `save()`
 * TypeORM lets the still-loaded relation object win over the FK: a value the file changed or
 * cleared is silently kept (the preview showed the change, the restore did not apply it).
 *
 * Before `upsert`, drop every loaded to-one relation of `existing` whose FK the file row changes.
 * One rule for every tab, so a new tab cannot forget it. The row's FK is read by the entity's own
 * property name (`resolved_by`, `class_id`): a row type that names it differently changes
 * nothing here, as before. A relation whose FK is unchanged stays loaded for `upsert` to read.
 */
export function dropStaleRelations(
  tab: TabSpec<any, any>,
  row: object,
  existing: object,
  m: EntityManager,
): void {
  if (!m.connection?.hasMetadata(tab.entity)) return; // test doubles have no schema
  const meta = m.connection.getMetadata(tab.entity);
  for (const rel of meta.relations) {
    if (!(rel.isManyToOne || (rel.isOneToOne && rel.isOwning))) continue;
    const fk = rel.joinColumns[0]?.propertyName;
    if (!fk) continue;
    const fromRow = (row as Record<string, unknown>)[fk];
    if (fromRow === undefined) continue; // the row does not carry this FK
    const stored = (existing as Record<string, unknown>)[fk] ?? null;
    if ((fromRow ?? null) !== stored) {
      (existing as Record<string, unknown>)[rel.propertyName] = undefined;
    }
  }
}
