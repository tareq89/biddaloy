import type { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';

const DAY_MS = 86_400_000;

export interface SeatSnapshot {
  /** `schools.seat_limit`; the entitlement job keeps it equal to the paid seats. */
  entitled: number;
  /** ACTIVE, non-deleted students (same count as the seat limit check). */
  used: number;
  /** First day with no paid cover (`period_end` of the last PAID order), YYYY-MM-DD, or null. */
  periodEnd: string | null;
  /** Whole days from `localDate` to `periodEnd`; 0 or negative once the seats have run out. */
  daysLeft: number | null;
}

/**
 * Seat state of one ACTIVE school, or null when it should raise nothing: gone, not ACTIVE,
 * or `seat_limit` is NULL (free period, D2). `localDate` is YYYY-MM-DD in school time.
 */
export async function seatSnapshot(
  dataSource: DataSource,
  tenantId: string,
  localDate: string,
): Promise<SeatSnapshot | null> {
  const [row]: { entitled: number; used: number; period_end: string | null }[] =
    await dataSource.query(
      `SELECT s.seat_limit AS entitled,
              (SELECT count(*)::int FROM students st
                WHERE st.tenant_id = s.id AND st.deleted_at IS NULL
                  AND st.enrollment_status = 'ACTIVE') AS used,
              (SELECT max(o.period_end)::text FROM seat_orders o
                WHERE o.school_id = s.id AND o.status = 'PAID') AS period_end
         FROM schools s
        WHERE s.id = $1 AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
          AND s.seat_limit IS NOT NULL`,
      [tenantId],
    );
  if (!row) return null;
  const periodEnd = row.period_end;
  const daysLeft = periodEnd
    ? Math.round((Date.parse(periodEnd) - Date.parse(localDate)) / DAY_MS)
    : null;
  return { entitled: row.entitled, used: row.used, periodEnd, daysLeft };
}

/** ACTIVE ADMIN members of the school. */
export async function adminRecipients(
  dataSource: DataSource,
  tenantId: string,
): Promise<{ userId: string; role: UserRole }[]> {
  const rows: { userId: string }[] = await dataSource.query(
    `SELECT ut.user_id AS "userId" FROM user_tenants ut
       JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      WHERE ut.tenant_id = $1 AND ut.role = 'ADMIN' AND ut.deleted_at IS NULL`,
    [tenantId],
  );
  return rows.map((r) => ({ userId: r.userId, role: UserRole.ADMIN }));
}
