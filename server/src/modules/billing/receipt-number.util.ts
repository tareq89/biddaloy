import type { EntityManager } from 'typeorm';
import { todayInSchoolTz } from '../../common/time';

/**
 * Next `SMR-YYYY-NNNNNN` (one platform-wide series per Asia/Dhaka year). Call it inside the
 * transaction that sets the number: the advisory lock holds until commit, so two payments
 * cannot read the same max. Only numbers matching the exact shape count.
 */
export async function nextReceiptNumber(manager: EntityManager): Promise<string> {
  const stem = `SMR-${todayInSchoolTz().slice(0, 4)}-`;
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`receipt:${stem}`]);
  const [{ n }] = await manager.query(
    `SELECT coalesce(max(substring(receipt_number from '[0-9]+$')::bigint), 0) + 1 AS n
       FROM seat_orders WHERE receipt_number ~ $1`,
    [`^${stem}[0-9]{1,15}$`],
  );
  return `${stem}${String(Number(n)).padStart(6, '0')}`;
}
