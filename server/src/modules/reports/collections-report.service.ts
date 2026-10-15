import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SCHOOL_TZ, startOfLocalDay, endOfLocalDay } from '../../common/time';
import { Payment } from '../fees/entities/payment.entity';
import { PaymentMethod } from '@biddaloy/shared';
import {
  COLLECTION_METHOD_GROUPS,
  CollectionGroupFigure,
  CollectionMethodGroup,
  CollectionTodayWidgetDto,
} from './dto/collection-today-widget.dto';
import { CollectionByMonthWidgetDto } from './dto/collection-by-month-widget.dto';
import {
  CollectionMonthFigures,
  CollectionMonthWidgetDto,
} from './dto/collection-month-widget.dto';
import {
  CollectionsCsvRow,
  CollectionsByCollector,
  CollectionsByDay,
  CollectionsByFeeType,
  CollectionsByMethod,
  CollectionsReportDto,
  CollectionsReportQueryDto,
} from './dto/collections-report.dto';

/** Cash actually received for a payment row: tendered minus wallet use plus
 * change kept in the wallet. A reversal row takes its original's cash
 * (needs `LEFT JOIN payments o ON o.id = p.reversal_of_payment_id`). */
const CASH_RECEIVED_SQL = `CASE WHEN p.reversal_of_payment_id IS NULL
  THEN p.total_amount - p.wallet_credit_used + p.wallet_credit_added
  ELSE o.total_amount - o.wallet_credit_used + o.wallet_credit_added END`;

/** Net of one payment row: a reversal row is a positive row that subtracts.
 * The same expression `getReport().totals.net` sums. */
const NET_SQL = `CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE -p.total_amount END`;

/** Widget grouping of payment methods (D23). */
const METHOD_GROUP: Record<PaymentMethod, CollectionMethodGroup> = {
  [PaymentMethod.CASH]: 'CASH',
  [PaymentMethod.BKASH]: 'BKASH',
  [PaymentMethod.CHEQUE]: 'BANK',
  [PaymentMethod.BANK_TRANSFER]: 'BANK',
  [PaymentMethod.CARD]: 'BANK',
  [PaymentMethod.NAGAD]: 'OTHER_MOBILE',
  [PaymentMethod.ROCKET]: 'OTHER_MOBILE',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Day 1 to the same day-of-month (clamped to the month's last day, so 31 Oct
 * maps to 30 Sep) for `month`/`year`. Pure UTC maths: no server-local `Date`
 * month arithmetic. */
function monthRange(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ym = `${year}-${pad(month)}`;
  return {
    from: `${ym}-01`,
    to: `${ym}-${pad(Math.min(day, last))}`,
    monthEnd: `${ym}-${pad(last)}`,
  };
}

interface PaymentTotalsRow {
  collected: string | null;
  reversed: string | null;
  net: string | null;
  wallet_used: string | null;
  wallet_added: string | null;
  change_returned: string | null;
}

interface DiscountTotalsRow {
  standing_discount: string | null;
  one_off_discount: string | null;
}

/**
 * [16.6.2] Backs `GET /reports/collections` and `GET /reports/collections.csv`.
 *
 * Every section is one aggregate SQL statement against `payments` (plus a
 * join through `payment_allocations` -> `student_fees` -> `fee_structures`
 * for the discount/fee-type breakdowns) — no N+1 per row.
 *
 * Reversal convention: **correction to D10** (flagged in the #671 hand-off
 * — the epic body and pre-flight comment both describe reversals as
 * *negative* `total_amount` rows, but the `payments` table's
 * `CHK_pay_total_amount CHECK (total_amount > 0)` constraint, unmodified
 * since the initial migration, makes that physically impossible to store
 * today). A reversal is instead its own `payments` row with a *positive*
 * `total_amount` (the magnitude reversed), identified structurally via
 * `reversal_of_payment_id IS NOT NULL` — exactly the convention
 * `payments-query.service.ts`'s `is_reversal` filter already uses. So
 * "collected" sums the non-reversal rows, "reversed" sums the reversal
 * rows, and "net" is collected minus reversed.
 *
 * Standing-discount attribution: `payment_allocations.discount_amount` only
 * ever records the *one-off* discount granted at checkout (D-something in
 * 16.1.6) — there is no per-payment record of how much of a bill's
 * *standing* discount (`student_fees.standing_discount_amount`) a given
 * payment "used up". This report attributes it proportionally: each
 * allocation's share of the bill's standing discount is
 * `standing_discount_amount * (allocated_amount / total_amount)`. That is
 * an approximation the plan doesn't spell out explicitly — flagged for
 * reviewer sign-off.
 */
@Injectable()
export class CollectionsReportService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  private buildRange(query: CollectionsReportQueryDto) {
    return {
      from: startOfLocalDay(query.from),
      to: endOfLocalDay(query.to),
    };
  }

  /** Shared WHERE-clause fragment + params every section filters payments
   * by: tenant, date range (in Dhaka calendar days), optional collector,
   * optional method. `deleted_at IS NULL` excludes soft-deleted payments.
   * `payment_status = 'SUCCESS'` excludes PENDING/FAILED rows — those are
   * not money collected and must never appear in a collections report.
   * A reversal's own compensating `Payment` row is created with
   * `payment_status: REFUNDED` (`payment-reversal.service.ts`), not
   * `SUCCESS` — without the `OR reversal_of_payment_id IS NOT NULL`
   * branch here, that row (and with it every reversal) was silently
   * dropped from `collected`/`reversed`/`net` below, which all read this
   * same filtered set and only tell the two kinds of row apart by that
   * column afterwards. */
  private buildFilter(
    tenantId: string,
    query: CollectionsReportQueryDto,
    alias = 'p',
  ): { clause: string; params: unknown[] } {
    const { from, to } = this.buildRange(query);
    const { clause, params } = this.buildFilterBetween(tenantId, from, to, alias);
    let out = clause;
    if (query.received_by_user_id) {
      params.push(query.received_by_user_id);
      out += ` AND ${alias}.received_by_user_id = $${params.length}`;
    }
    if (query.payment_method) {
      params.push(query.payment_method);
      out += ` AND ${alias}.payment_method = $${params.length}`;
    }
    return { clause: out, params };
  }

  /** The WHERE text itself, for an instant range [from, to] (so "until now"
   * is possible). Tenant, soft delete and SUCCESS/reversal rules live only here. */
  private buildFilterBetween(
    tenantId: string,
    from: Date,
    to: Date,
    alias = 'p',
  ): { clause: string; params: unknown[] } {
    const clause = `${alias}.tenant_id = $1 AND ${alias}.deleted_at IS NULL AND ${alias}.payment_date BETWEEN $2 AND $3 AND (${alias}.payment_status = 'SUCCESS' OR ${alias}.reversal_of_payment_id IS NOT NULL OR ${alias}.reversed_by_payment_id IS NOT NULL)`;
    return { clause, params: [tenantId, from, to] };
  }

  /** Net cash received (SUCCESS payments, reversals subtracted) for the
   * range. Same filter and `net` expression as `getReport().totals.net`. */
  async getReceived(tenantId: string, from: string, to: string): Promise<number> {
    const { clause, params } = this.buildFilter(tenantId, { from, to });
    const rows = await this.paymentRepo.manager.query<Array<{ net: string | null }>>(
      `SELECT COALESCE(SUM(${NET_SQL}), 0) AS net
       FROM payments p
       WHERE ${clause}`,
      params,
    );
    return Number(rows[0]?.net ?? 0);
  }

  /** Net and payment count per payment method for an instant range. */
  async getNetByMethodBetween(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ payment_method: PaymentMethod; net: number; payment_count: number }>> {
    const { clause, params } = this.buildFilterBetween(tenantId, from, to);
    const rows = await this.paymentRepo.manager.query<
      Array<{ payment_method: PaymentMethod; net: string; payment_count: string }>
    >(
      `SELECT p.payment_method,
         COALESCE(SUM(${NET_SQL}), 0) AS net,
         COUNT(*) FILTER (WHERE p.reversal_of_payment_id IS NULL) AS payment_count
       FROM payments p
       WHERE ${clause}
       GROUP BY p.payment_method`,
      params,
    );
    return rows.map((r) => ({
      payment_method: r.payment_method,
      net: Number(r.net),
      payment_count: Number(r.payment_count),
    }));
  }

  /** Net per school-local month of `year`: index 0 = January. */
  async getNetByMonth(tenantId: string, year: number): Promise<number[]> {
    const { clause, params } = this.buildFilterBetween(
      tenantId,
      startOfLocalDay(`${year}-01-01`),
      endOfLocalDay(`${year}-12-31`),
    );
    const rows = await this.paymentRepo.manager.query<Array<{ month: number; net: string }>>(
      `SELECT EXTRACT(MONTH FROM p.payment_date AT TIME ZONE '${SCHOOL_TZ}')::int AS month,
         COALESCE(SUM(${NET_SQL}), 0) AS net
       FROM payments p
       WHERE ${clause}
       GROUP BY 1`,
      params,
    );
    const slots = Array<number>(12).fill(0);
    for (const r of rows) slots[r.month - 1] = Number(r.net);
    return slots;
  }

  /** `today` is the school's local date from `SchoolsService.todayFor`; `now`
   * is injectable for tests. */
  async getCollectionTodayWidget(
    tenantId: string,
    today: string,
    now: Date = new Date(),
  ): Promise<CollectionTodayWidgetDto> {
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const [rows, yRows] = await Promise.all([
      this.getNetByMethodBetween(tenantId, startOfLocalDay(today), now),
      this.getNetByMethodBetween(
        tenantId,
        startOfLocalDay(yesterday.toISOString().slice(0, 10)),
        new Date(now.getTime() - 24 * 3600 * 1000),
      ),
    ]);
    const groups: CollectionGroupFigure[] = COLLECTION_METHOD_GROUPS.map((group) => {
      const methods = rows
        .filter((r) => METHOD_GROUP[r.payment_method] === group)
        .sort((a, b) => b.net - a.net);
      return {
        group,
        net: methods.reduce((a, m) => a + m.net, 0),
        payment_count: methods.reduce((a, m) => a + m.payment_count, 0),
        methods,
      };
    });
    return {
      date: today,
      net: groups.reduce((a, g) => a + g.net, 0),
      payment_count: groups.reduce((a, g) => a + g.payment_count, 0),
      yesterday_same_time_net: yRows.reduce((a, r) => a + r.net, 0),
      groups,
    };
  }

  async getCollectionByMonthWidget(
    tenantId: string,
    today: string,
  ): Promise<CollectionByMonthWidgetDto> {
    const [y, m, d] = today.split('-').map(Number);
    const prev = monthRange(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, d);
    const [slots, previous] = await Promise.all([
      this.getNetByMonth(tenantId, y),
      this.getReceived(tenantId, prev.from, prev.to),
    ]);
    // Months after the current one are null, whatever future-dated rows exist.
    const months = slots.map((net, i) => ({
      month: i + 1,
      net: i + 1 > m ? null : net,
      is_current: i + 1 === m,
    }));
    return {
      year: y,
      year_to_date_net: slots.slice(0, m).reduce((a, n) => a + n, 0),
      month_to_date_net: slots[m - 1],
      previous_month_same_days_net: previous,
      months,
    };
  }

  /** Accrual basis: `total - discount` of live bills whose `period_start`
   * falls in [monthStart, monthEnd], paid or not. `student_fees` has no
   * `tenant_id` column, so the tenant comes from the student. */
  async getBilledForMonth(tenantId: string, monthStart: string, monthEnd: string): Promise<number> {
    const rows = await this.paymentRepo.manager.query<Array<{ billed: string | null }>>(
      `SELECT COALESCE(SUM(sf.total_amount - sf.discount_amount), 0) AS billed
       FROM student_fees sf
       JOIN students s ON s.id = sf.student_id
       WHERE s.tenant_id = $1 AND sf.deleted_at IS NULL
         AND sf.period_start BETWEEN $2 AND $3`,
      [tenantId, monthStart, monthEnd],
    );
    return Number(rows[0]?.billed ?? 0);
  }

  /** `today` is the school's local date (YYYY-MM-DD) from `SchoolsService.todayFor`. */
  async getCollectionMonthWidget(
    tenantId: string,
    today: string,
  ): Promise<CollectionMonthWidgetDto> {
    type Range = ReturnType<typeof monthRange>;
    const [y, m, d] = today.split('-').map(Number);
    const figures = async (r: Range) => {
      const [received, billed] = await Promise.all([
        this.getReceived(tenantId, r.from, r.to),
        this.getBilledForMonth(tenantId, r.from, r.monthEnd),
      ]);
      return { received, billed };
    };
    const point = (r: Range, f: { received: number; billed: number }): CollectionMonthFigures => ({
      as_of: r.to,
      received: f.received,
      billed_for_month: f.billed,
      received_pct: f.billed === 0 ? null : Math.round((f.received / f.billed) * 100),
    });

    const cur = monthRange(y, m, d);
    const lm = monthRange(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, d);
    const ly = monthRange(y - 1, m, d);
    const [fc, fm, fy] = await Promise.all([figures(cur), figures(lm), figures(ly)]);
    return {
      month: `${y}-${pad(m)}`,
      ...point(cur, fc),
      last_month_same_point: point(lm, fm),
      // No bills and no net cash that month last year: client shows "—" (D25).
      last_year_same_point: fy.billed === 0 && fy.received === 0 ? null : point(ly, fy),
    };
  }

  async getReport(
    tenantId: string,
    query: CollectionsReportQueryDto,
  ): Promise<CollectionsReportDto> {
    const { clause, params } = this.buildFilter(tenantId, query, 'p');

    const totalsRowP = this.paymentRepo.manager.query<PaymentTotalsRow[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NOT NULL THEN p.total_amount ELSE 0 END), 0) AS reversed,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE -p.total_amount END), 0) AS net,
         COALESCE(SUM(p.wallet_credit_used), 0) AS wallet_used,
         COALESCE(SUM(p.wallet_credit_added), 0) AS wallet_added,
         COALESCE(SUM(p.change_amount), 0) AS change_returned
       FROM payments p
       WHERE ${clause}`,
      params,
    );

    // Excludes reversal-linked payments' allocations: a reversal writes its
    // own payment_allocations row(s) mirroring the original, and without
    // this filter its discount would be double-counted on top of the
    // original payment's, inflating standing_discount/one_off_discount.
    const discountRowP = this.paymentRepo.manager.query<DiscountTotalsRow[]>(
      `SELECT
         COALESCE(SUM(sf.standing_discount_amount * (pa.allocated_amount / NULLIF(sf.total_amount, 0))), 0) AS standing_discount,
         COALESCE(SUM(pa.discount_amount), 0) AS one_off_discount
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN student_fees sf ON sf.id = pa.student_fee_id
       WHERE ${clause} AND p.reversal_of_payment_id IS NULL`,
      params,
    );

    const byMethodP = this.paymentRepo.manager.query<
      Array<{
        payment_method: PaymentMethod;
        count: string;
        collected: string;
        reversed: string;
        net: string;
      }>
    >(
      `SELECT
         p.payment_method,
         COUNT(*) AS count,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN ${CASH_RECEIVED_SQL} ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NOT NULL THEN ${CASH_RECEIVED_SQL} ELSE 0 END), 0) AS reversed,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN ${CASH_RECEIVED_SQL} ELSE -(${CASH_RECEIVED_SQL}) END), 0) AS net
       FROM payments p
       LEFT JOIN payments o ON o.id = p.reversal_of_payment_id
       WHERE ${clause}
       GROUP BY p.payment_method
       ORDER BY p.payment_method`,
      params,
    );

    const byCollectorP = this.paymentRepo.manager.query<
      Array<{
        user_id: string | null;
        full_name: string | null;
        count: string;
        collected: string;
        reversed: string;
        net: string;
      }>
    >(
      `SELECT
         p.received_by_user_id AS user_id,
         u.full_name AS full_name,
         COUNT(*) AS count,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN ${CASH_RECEIVED_SQL} ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NOT NULL THEN ${CASH_RECEIVED_SQL} ELSE 0 END), 0) AS reversed,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN ${CASH_RECEIVED_SQL} ELSE -(${CASH_RECEIVED_SQL}) END), 0) AS net
       FROM payments p
       LEFT JOIN payments o ON o.id = p.reversal_of_payment_id
       LEFT JOIN users u ON u.id = p.received_by_user_id
       WHERE ${clause}
       GROUP BY p.received_by_user_id, u.full_name
       ORDER BY full_name NULLS LAST`,
      params,
    );

    const byFeeTypeP = this.paymentRepo.manager.query<
      Array<{ fee_type: string; collected: string; discount: string }>
    >(
      `SELECT
         fs.fee_type AS fee_type,
         COALESCE(SUM(pa.allocated_amount), 0) AS collected,
         -- Each SUM is COALESCEd separately: a fee_type group where every
         -- row has sf.total_amount = 0 (fully waived) would otherwise make
         -- the standing_discount SUM NULL, and NULL + real_discount = NULL
         -- silently zeroes out the group's genuine one_off_discount too.
         COALESCE(SUM(pa.discount_amount), 0)
           + COALESCE(SUM(sf.standing_discount_amount * (pa.allocated_amount / NULLIF(sf.total_amount, 0))), 0)
           AS discount
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN student_fees sf ON sf.id = pa.student_fee_id
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       WHERE ${clause} AND p.reversal_of_payment_id IS NULL
       GROUP BY fs.fee_type
       ORDER BY fs.fee_type`,
      params,
    );

    const byDayP = this.paymentRepo.manager.query<
      Array<{ date: string; collected: string; reversed: string; net: string }>
    >(
      `SELECT
         (p.payment_date AT TIME ZONE '${SCHOOL_TZ}')::date::text AS date,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NOT NULL THEN p.total_amount ELSE 0 END), 0) AS reversed,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE -p.total_amount END), 0) AS net
       FROM payments p
       WHERE ${clause}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    // Six independent aggregates over the same WHERE clause — run
    // concurrently rather than six round trips in series.
    const [totalsRow, discountRow, byMethod, byCollector, byFeeType, byDay] = await Promise.all([
      totalsRowP,
      discountRowP,
      byMethodP,
      byCollectorP,
      byFeeTypeP,
      byDayP,
    ]);

    return {
      range: { from: query.from, to: query.to },
      totals: {
        collected: Number(totalsRow[0]?.collected ?? 0),
        reversed: Number(totalsRow[0]?.reversed ?? 0),
        net: Number(totalsRow[0]?.net ?? 0),
        standing_discount: Number(discountRow[0]?.standing_discount ?? 0),
        one_off_discount: Number(discountRow[0]?.one_off_discount ?? 0),
        wallet_used: Number(totalsRow[0]?.wallet_used ?? 0),
        wallet_added: Number(totalsRow[0]?.wallet_added ?? 0),
        change_returned: Number(totalsRow[0]?.change_returned ?? 0),
      },
      by_method: byMethod.map((r): CollectionsByMethod => ({
        payment_method: r.payment_method,
        count: Number(r.count),
        collected: Number(r.collected),
        reversed: Number(r.reversed),
        net: Number(r.net),
      })),
      by_collector: byCollector.map((r): CollectionsByCollector => ({
        user_id: r.user_id,
        full_name: r.full_name,
        count: Number(r.count),
        collected: Number(r.collected),
        reversed: Number(r.reversed),
        net: Number(r.net),
      })),
      by_fee_type: byFeeType.map((r): CollectionsByFeeType => ({
        fee_type: r.fee_type,
        collected: Number(r.collected),
        discount: Number(r.discount),
      })),
      by_day: byDay.map((r): CollectionsByDay => ({
        date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
        collected: Number(r.collected),
        reversed: Number(r.reversed),
        net: Number(r.net),
      })),
    };
  }

  /** Per-payment rows backing the CSV export — one row per payment
   * (including reversals, flagged via `is_reversal`), each carrying the
   * sum of its own allocations' one-off discount. Standing discount isn't
   * broken out per-row on the CSV (only in the JSON report's totals /
   * by_fee_type sections) since a single payment can touch several bills
   * with different standing-discount rates. */
  async getCsvRows(
    tenantId: string,
    query: CollectionsReportQueryDto,
  ): Promise<CollectionsCsvRow[]> {
    const { clause, params } = this.buildFilter(tenantId, query, 'p');

    const rows = await this.paymentRepo.manager.query<
      Array<{
        date: string;
        invoice_number: string | null;
        student_name: string | null;
        payment_method: PaymentMethod;
        transaction_reference: string | null;
        collector_name: string | null;
        amount: string;
        discount: string | null;
        is_reversal: boolean;
      }>
    >(
      `SELECT
         -- Dhaka-local, not UTC: a payment at 2026-03-16 02:00 Dhaka is
         -- stored as 2026-03-15T20:00:00Z — new Date(...).toISOString()
         -- in JS would stamp it with the wrong calendar day. by_day above
         -- already converts the same way; this keeps the CSV consistent.
         to_char(p.payment_date AT TIME ZONE '${SCHOOL_TZ}', 'YYYY-MM-DD"T"HH24:MI:SS') AS date,
         i.invoice_number AS invoice_number,
         s.full_name AS student_name,
         p.payment_method AS payment_method,
         p.transaction_reference AS transaction_reference,
         u.full_name AS collector_name,
         p.total_amount AS amount,
         COALESCE(alloc.discount_total, 0) AS discount,
         (p.reversal_of_payment_id IS NOT NULL) AS is_reversal
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN students s ON s.id = p.student_id
       LEFT JOIN users u ON u.id = p.received_by_user_id
       LEFT JOIN (
         SELECT payment_id, SUM(discount_amount) AS discount_total
         FROM payment_allocations
         GROUP BY payment_id
       ) alloc ON alloc.payment_id = p.id
       WHERE ${clause}
       ORDER BY p.payment_date ASC, p.id ASC`,
      params,
    );

    return rows.map((r) => ({
      date: r.date,
      invoice_number: r.invoice_number ?? '',
      student_name: r.student_name ?? '',
      payment_method: r.payment_method,
      transaction_reference: r.transaction_reference,
      collector_name: r.collector_name,
      amount: Number(r.amount),
      discount: Number(r.discount ?? 0),
      is_reversal: r.is_reversal,
    }));
  }
}
