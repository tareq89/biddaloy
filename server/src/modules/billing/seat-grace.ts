import { EnrollmentStatus, SchoolStatus, SeatOrderStatus } from '@biddaloy/shared';
import { billingFreeUntil } from '../../config/env.validation';
import { SCHOOL_TZ, localDate, startOfLocalDay } from '../../common/time';

export const SEAT_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Anything with a raw `query`: an EntityManager, a Repository or a DataSource. No service imports here. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<any>;
}

/**
 * Seat grace (Epic 49 D9). A school is "over" when it is ACTIVE, has a seat limit and more ACTIVE
 * students than that limit (same count as `seat-limit.service`). Its read-only window ends 7 days
 * after the latest of its last paid period end, `BILLING_FREE_UNTIL` and its registration day, at
 * school-local midnight. Returns `null` when the school is not over.
 */
export async function readOnlyUntilFor(
  db: Queryable,
  schoolId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const today = localDate(now, SCHOOL_TZ);
  const [row]: { over: boolean; anchor: string | null; created: string }[] = await db.query(
    `SELECT (s.seat_limit IS NOT NULL AND s.seat_limit < (
               SELECT count(*) FROM students st
                WHERE st.tenant_id = s.id AND st.deleted_at IS NULL AND st.enrollment_status = $4
             )) AS over,
            (SELECT max(o.period_end)::text FROM seat_orders o
              WHERE o.school_id = s.id AND o.status = $3 AND o.period_end <= $2::date) AS anchor,
            (s.created_at AT TIME ZONE $6)::date::text AS created
       FROM schools s
      WHERE s.id = $1 AND s.status = $5 AND s.deleted_at IS NULL`,
    [
      schoolId,
      today,
      SeatOrderStatus.PAID,
      EnrollmentStatus.ACTIVE,
      SchoolStatus.ACTIVE,
      SCHOOL_TZ,
    ],
  );
  if (!row?.over) return null;
  // Latest of: last paid period end, free-period end, registration day. So no school gets less
  // than a full 7-day window (an old order, or a school registered after the free period).
  // ISO dates compare correctly as strings.
  const anchor = [row.anchor, localDate(billingFreeUntil(), SCHOOL_TZ), row.created]
    .filter((d): d is string => !!d)
    .reduce((a, b) => (a > b ? a : b));
  return new Date(startOfLocalDay(anchor, SCHOOL_TZ).getTime() + SEAT_GRACE_DAYS * DAY_MS);
}
