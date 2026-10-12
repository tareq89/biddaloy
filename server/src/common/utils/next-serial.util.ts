import type { EntityManager } from 'typeorm';
import { escapeLikePattern } from './escape-like.util';

/**
 * Next number in a school's prefixed text series (e.g. `INV-2026-` -> 1, 2, ...).
 *
 * Takes a transaction-scoped advisory lock keyed on `<tenant>:<prefix>` first, so two concurrent
 * callers cannot read the same max; call it inside the transaction that inserts the row.
 * The max is taken over the numeric suffix (never a text sort), only inside this tenant, and
 * only over values that match `^<prefix>[0-9]{1,15}$`, so junk like `INV-2026-zzz` is ignored.
 * Suffixes longer than 15 digits (e.g. from a restored workbook) are ignored too: they could
 * overflow the bigint cast or lose precision as a JS number. The prefix is matched literally.
 * Soft-deleted rows are included on purpose: their numbers stay taken.
 *
 * `table` and `column` are interpolated into the SQL: pass code constants only, never user input.
 */
export async function nextTenantSerial(
  manager: EntityManager,
  opts: { table: string; column: string; tenantId: string; prefix: string },
): Promise<number> {
  const { table, column, tenantId, prefix } = opts;
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tenantId}:${prefix}`]);
  const [{ n }] = await manager.query(
    `SELECT coalesce(max(substring("${column}" from '[0-9]+$')::bigint), 0) + 1 AS n
       FROM "${table}" WHERE tenant_id = $1 AND "${column}" LIKE $3 AND "${column}" ~ $2`,
    [
      tenantId,
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9]{1,15}$`,
      `${escapeLikePattern(prefix)}%`,
    ],
  );
  return Number(n);
}
