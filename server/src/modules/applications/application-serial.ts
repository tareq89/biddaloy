import type { EntityManager } from 'typeorm';

/**
 * Next serial number for a school's applications in `year` (D29). Takes a transaction-scoped
 * advisory lock first, so two concurrent submits cannot read the same max; call it inside the
 * transaction that inserts the application (the lock is released at commit).
 */
export async function nextApplicationSerial(
  manager: EntityManager,
  tenantId: string,
  year: number,
): Promise<number> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `${tenantId}:APPLICATION:${year}`,
  ]);
  const [{ n }] = await manager.query(
    `SELECT coalesce(max(serial_no), 0) + 1 AS n FROM applications
      WHERE tenant_id = $1 AND serial_year = $2`,
    [tenantId, year],
  );
  return Number(n);
}

/** `2026/0045`. Latin digits always, even for a Bangla school (D47). */
export function formatApplicationSerial(year: number, no: number): string {
  return `${year}/${String(no).padStart(4, '0')}`;
}
