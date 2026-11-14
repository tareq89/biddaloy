import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toCsvContent } from '@biddaloy/shared';
import { todayInSchoolTz } from '../../common/time';
import type { NotRenewedRow, RevenueReport, RevenueSchoolRow } from './dto/revenue.dto';
import { revenueWindow } from './revenue-month';

const DEFAULT_LIMIT = 50;
const BAD_CURSOR = 'Invalid cursor';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): { d: string; id: string } {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      d?: unknown;
      id?: unknown;
    };
    if (
      typeof v.d === 'string' &&
      typeof v.id === 'string' &&
      DATE_RE.test(v.d) &&
      !Number.isNaN(Date.parse(v.d)) &&
      UUID_RE.test(v.id)
    ) {
      return { d: v.d, id: v.id };
    }
  } catch {
    /* fall through */
  }
  throw new BadRequestException(BAD_CURSOR);
}

const encodeCursor = (r: NotRenewedRow) =>
  Buffer.from(JSON.stringify({ d: r.paid_until, id: r.school_id })).toString('base64url');

/** Read-only owner revenue report (#3873). Orders are platform-owned money, keyed by `school_id`. */
@Injectable()
export class RevenueService {
  constructor(private readonly ds: DataSource) {}

  /**
   * One row per school with money in the month. Income counts by `paid_at`, refunds by `refunded_at`
   * (a refunded seat order has status REFUNDED but was paid). A GRANT (unit price 0) and a 100 percent
   * coupon order contribute 0 by amount.
   */
  async schoolRows(month?: string): Promise<{ month: string; rows: RevenueSchoolRow[] }> {
    const w = revenueWindow(month);
    const raw = (await this.ds.query(
      `WITH s AS (
         SELECT school_id,
           COALESCE(SUM(amount_paisa) FILTER (WHERE status IN ('PAID','REFUNDED')
             AND unit_price_paisa > 0 AND paid_at >= $1 AND paid_at < $2), 0) AS inc,
           COALESCE(SUM(amount_paisa) FILTER (WHERE status = 'REFUNDED'
             AND unit_price_paisa > 0 AND refunded_at >= $1 AND refunded_at < $2), 0) AS ref
         FROM seat_orders GROUP BY school_id
       ), p AS (
         SELECT school_id,
           COALESCE(SUM(price_paisa) FILTER (WHERE status IN ('PAID','ACTIVE','USED_UP','EXPIRED','REFUNDED')
             AND paid_at >= $1 AND paid_at < $2), 0) AS inc,
           COALESCE(SUM(price_paisa) FILTER (WHERE status = 'REFUNDED' AND paid_at IS NOT NULL
             AND refunded_at >= $1 AND refunded_at < $2), 0) AS ref
         FROM sms_bundle_orders GROUP BY school_id
       )
       SELECT sc.id AS school_id, sc.name AS school,
              COALESCE(s.inc, 0)::text AS seat_inc, COALESCE(p.inc, 0)::text AS pkg_inc,
              (COALESCE(s.ref, 0) + COALESCE(p.ref, 0))::text AS refunds
         FROM schools sc
         LEFT JOIN s ON s.school_id = sc.id
         LEFT JOIN p ON p.school_id = sc.id
        WHERE COALESCE(s.inc, 0) + COALESCE(p.inc, 0) + COALESCE(s.ref, 0) + COALESCE(p.ref, 0) > 0
        ORDER BY sc.name, sc.id`,
      [w.start, w.end],
    )) as {
      school_id: string;
      school: string;
      seat_inc: string;
      pkg_inc: string;
      refunds: string;
    }[];
    // ponytail: Number is exact below 2^53 paisa (~9e13 taka); switch to BigInt strings if totals near it.
    const rows = raw.map((r) => {
      const seat = Number(r.seat_inc);
      const pkg = Number(r.pkg_inc);
      const refunds = Number(r.refunds);
      return {
        school_id: r.school_id,
        school: r.school,
        seat_income_paisa: seat,
        package_income_paisa: pkg,
        refunds_paisa: refunds,
        net_paisa: seat + pkg - refunds,
      };
    });
    return { month: w.month, rows };
  }

  async report(month?: string, cursor?: string, limit = DEFAULT_LIMIT): Promise<RevenueReport> {
    const cur = cursor ? decodeCursor(cursor) : null; // validate before any query
    const { month: m, rows } = await this.schoolRows(month);
    const sum = (k: 'seat_income_paisa' | 'package_income_paisa' | 'refunds_paisa') =>
      rows.reduce((a, r) => a + r[k], 0);
    const seat = sum('seat_income_paisa');
    const pkg = sum('package_income_paisa');
    const refunds = sum('refunds_paisa');
    return {
      month: m,
      seat_income_paisa: seat,
      package_income_paisa: pkg,
      refunds_paisa: refunds,
      net_paisa: seat + pkg - refunds,
      paying_schools: rows.filter((r) => r.seat_income_paisa + r.package_income_paisa > 0).length,
      not_renewed: await this.notRenewed(cur, limit),
    };
  }

  /**
   * Schools whose paid-until (same expression as the school's billing summary, own paying orders only)
   * is before today. Newest-ended first; keyset on (paid_until, school_id).
   */
  async notRenewed(
    cur: { d: string; id: string } | null,
    limit: number,
  ): Promise<{ items: NotRenewedRow[]; next_cursor: string | null }> {
    const params: unknown[] = [todayInSchoolTz(), limit + 1];
    if (cur) params.push(cur.d, cur.id);
    const raw = (await this.ds.query(
      `SELECT sc.id AS school_id, sc.name, pu.paid_until::text AS paid_until,
              ($1::date - pu.paid_until)::int AS days_since_ended, pl.name AS plan
         FROM (SELECT school_id, (max(period_end) - 1) AS paid_until
                 FROM seat_orders WHERE status = 'PAID' AND unit_price_paisa > 0
                GROUP BY school_id) pu
         JOIN schools sc ON sc.id = pu.school_id AND sc.deleted_at IS NULL
         LEFT JOIN plans pl ON pl.id = sc.plan_id
        WHERE pu.paid_until < $1::date
          ${cur ? 'AND (pu.paid_until, sc.id) < ($3::date, $4::uuid)' : ''}
        ORDER BY pu.paid_until DESC, sc.id DESC
        LIMIT $2`,
      params,
    )) as NotRenewedRow[];
    const items = raw.slice(0, limit);
    return {
      items,
      next_cursor: raw.length > limit ? encodeCursor(items[items.length - 1]) : null,
    };
  }

  async csv(month?: string): Promise<{ month: string; body: string }> {
    const { month: m, rows } = await this.schoolRows(month);
    const body = toCsvContent([
      ['School', 'Seat income (paisa)', 'Package income (paisa)', 'Refunds (paisa)', 'Net (paisa)'],
      ...rows.map((r) => [
        r.school,
        r.seat_income_paisa,
        r.package_income_paisa,
        r.refunds_paisa,
        r.net_paisa,
      ]),
    ]);
    return { month: m, body };
  }
}
