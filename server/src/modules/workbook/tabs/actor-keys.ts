import type { EntityManager, EntityTarget } from 'typeorm';
import { memberKeysById } from './people/users.tab';

/**
 * #2687 (D12): nullable actor columns (invigilator, recorder, approver...).
 * The export writes a blank cell for an actor who is no longer a member.
 * On restore, a blank cell therefore means:
 *   - stored actor departed -> keep it (the blank is the export's, not an edit)
 *   - stored actor current  -> clear it (the user blanked the cell)
 */

/** Marks each loaded row with `keyProp`: the actor's key, or '' when they have left. */
export async function stampActorKeys<T extends object>(
  tenantId: string,
  rows: T[],
  idProp: keyof T & string,
  keyProp: string,
  m: EntityManager,
): Promise<T[]> {
  const ids = rows.flatMap((r) => {
    const id = r[idProp];
    return typeof id === 'string' ? [id] : [];
  });
  const keyById = await memberKeysById(tenantId, ids, m);
  for (const r of rows) {
    const id = r[idProp];
    (r as Record<string, unknown>)[keyProp] = (typeof id === 'string' && keyById.get(id)) || '';
  }
  return rows;
}

/**
 * NOT NULL actor: the row's own, else the stored one, else the user running the
 * restore (validation already warned). Throws when none is set.
 */
export function actorOrRestorer(
  what: string,
  ...candidates: Array<string | null | undefined>
): string {
  const found = candidates.find((c) => !!c);
  if (!found) throw new Error(`${what} is blank and there is no restoring user to record.`);
  return found;
}

/**
 * Nullable actor to store: the cell's id, else the stored actor when they have
 * left (the blank is the export's), else null (the user cleared a current one).
 * `diffFields` compares this against the stored value.
 */
export function nullableActor<T extends object>(
  cell: string | null | undefined,
  existing: T | null | undefined,
  idProp: keyof T & string,
  keyProp: string,
): string | null {
  if (cell) return cell;
  const stored = existing?.[idProp] as unknown as string | null | undefined;
  return stored && !(existing as Record<string, unknown>)[keyProp] ? stored : null;
}

/**
 * On insert keep the file row's id when no row anywhere holds it, so a second
 * restore of the same file matches by id instead of recreating the row. A row
 * held by another tenant (or soft-deleted) keeps a fresh id.
 */
export async function keepFileId<T extends { id: string }>(
  entityClass: EntityTarget<T>,
  entity: T,
  rowId: string | undefined,
  m: EntityManager,
): Promise<void> {
  if (!rowId) return;
  const taken = await m.findOne(entityClass, {
    where: { id: rowId } as never,
    withDeleted: true,
  });
  if (!taken) entity.id = rowId;
}
