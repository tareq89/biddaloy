import { EnrollmentStatus, SchoolStatus, SeatOrderStatus } from '@biddaloy/shared';
import { billingFreeUntil } from '../../config/env.validation';
import { SCHOOL_TZ, localDate, startOfLocalDay } from '../../common/time';

export const SEAT_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Anything with a raw `query`: an EntityManager, a Repository or a DataSource. No service imports here. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<any>;
}

export interface SeatCover {
  /** First day with no cover (YYYY-MM-DD): the last PAID `period_end`, or the
   * `BILLING_FREE_UNTIL` day when that is later (e.g. a school that never paid). */
  periodEnd: string;
  /** Seats of the PAID orders ending on `periodEnd`; 0 when the free period is the cover. */
  seats: number;
  /** The cover that ends is the free period, not a paid order. */
  free: boolean;
  /** The paid order(s) ending on `periodEnd` are 31 days or shorter: too short for a 30-day warning. */
  short: boolean;
}

/**
 * What covers a school's seats last, for the 30 / 7 / 0 day warnings (notices and attention).
 * The school's own orders count; a GRANT (unit price 0) only when it has no own order, so a long
 * grant cannot hide the end of what the school paid for.
 */
export async function seatCover(db: Queryable, schoolId: string): Promise<SeatCover> {
  const [last]: { period_end: string; seats: number; days: number }[] = await db.query(
    `SELECT period_end::text AS period_end, SUM(seats)::int AS seats,
            MAX(period_end - period_start)::int AS days
       FROM seat_orders WHERE school_id = $1 AND status = $2
      GROUP BY unit_price_paisa > 0, period_end
      ORDER BY unit_price_paisa > 0 DESC, period_end DESC LIMIT 1`,
    [schoolId, SeatOrderStatus.PAID],
  );
  const freeEnd = localDate(billingFreeUntil(), SCHOOL_TZ);
  // ISO dates compare correctly as strings.
  if (!last || last.period_end < freeEnd) {
    return { periodEnd: freeEnd, seats: 0, free: true, short: false };
  }
  return { periodEnd: last.period_end, seats: last.seats, free: false, short: last.days <= 31 };
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
