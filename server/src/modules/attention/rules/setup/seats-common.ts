import type { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { seatCover } from '../../../billing/seat-grace';

const DAY_MS = 86_400_000;

export interface SeatSnapshot {
  /** `schools.seat_limit` (0 in the free period); the entitlement job keeps it equal to the paid seats. */
  entitled: number;
  /** `seat_limit` is NULL: the free period, every student is free (D2). */
  free: boolean;
  /** ACTIVE, non-deleted students (same count as the seat limit check). */
  used: number;
  /** First day with no cover, YYYY-MM-DD: the last PAID `period_end`, or the
   * `BILLING_FREE_UNTIL` day for a school that never paid for later seats (`seatCover`). */
  periodEnd: string;
  /** Whole days from `localDate` to `periodEnd`; 0 or negative once the seats have run out. */
  daysLeft: number;
  /** The last paid order is 31 days or shorter (no 30-day warning for it). */
  shortPeriod: boolean;
}

/**
 * Seat state of one ACTIVE school, or null when it should raise nothing: gone or not ACTIVE.
 * `localDate` is YYYY-MM-DD in school time.
 */
export async function seatSnapshot(
  dataSource: DataSource,
  tenantId: string,
  localDate: string,
): Promise<SeatSnapshot | null> {
  const [row]: { seat_limit: number | null; used: number }[] = await dataSource.query(
    `SELECT s.seat_limit,
            (SELECT count(*)::int FROM students st
              WHERE st.tenant_id = s.id AND st.deleted_at IS NULL
                AND st.enrollment_status = 'ACTIVE') AS used
       FROM schools s
      WHERE s.id = $1 AND s.status = 'ACTIVE' AND s.deleted_at IS NULL`,
    [tenantId],
  );
  if (!row) return null;
  const cover = await seatCover(dataSource, tenantId);
  return {
    entitled: row.seat_limit ?? 0,
    free: row.seat_limit === null,
    used: row.used,
    periodEnd: cover.periodEnd,
    daysLeft: Math.round((Date.parse(cover.periodEnd) - Date.parse(localDate)) / DAY_MS),
    shortPeriod: cover.short,
  };
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
