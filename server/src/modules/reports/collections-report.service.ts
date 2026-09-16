import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../fees/entities/payment.entity';
import { PaymentMethod } from '@biddaloy/shared';
import {
  CollectionsCsvRow,
  CollectionsByCollector,
  CollectionsByDay,
  CollectionsByFeeType,
  CollectionsByMethod,
  CollectionsReportDto,
  CollectionsReportQueryDto,
} from './dto/collections-report.dto';

/** [D14] Same reasoning as `payments-query.service.ts`'s own copy — every
 * "which school calendar day did this fall on" comparison goes through the
 * tenant's calendar day in Asia/Dhaka, never server-local/UTC time. This
 * report's territory doesn't include wiring up shared date-utility
 * plumbing across modules (there is no `server/src/common/time.ts` yet —
 * confirmed absent in the pre-flight comment on #671), so it duplicates the
 * same small helper the fees module already carries three copies of. */
const SCHOOL_TIMEZONE = 'Asia/Dhaka';

/** Converts a `YYYY-MM-DD` filter value into the UTC instant of that
 * calendar day's midnight *in the school's timezone*. */
function startOfDayInSchoolTimezone(dateStr: string): Date {
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
  const tzMs = new Date(
    utcMidnight.toLocaleString('en-US', { timeZone: SCHOOL_TIMEZONE }),
  ).getTime();
  const utcMs = new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const offsetMs = tzMs - utcMs;
  return new Date(utcMidnight.getTime() - offsetMs);
}

/** The UTC instant one millisecond before the *next* calendar day starts in
 * the school's timezone — i.e. the last instant of `dateStr` in Dhaka. */
function endOfDayInSchoolTimezone(dateStr: string): Date {
  const nextDay = new Date(`${dateStr}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);
  return new Date(startOfDayInSchoolTimezone(nextDayStr).getTime() - 1);
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
      from: startOfDayInSchoolTimezone(query.from),
      to: endOfDayInSchoolTimezone(query.to),
    };
  }

  /** Shared WHERE-clause fragment + params every section filters payments
   * by: tenant, date range (in Dhaka calendar days), optional collector,
   * optional method. `deleted_at IS NULL` excludes soft-deleted payments. */
  private buildFilter(
    tenantId: string,
    query: CollectionsReportQueryDto,
    alias = 'p',
  ): { clause: string; params: unknown[] } {
    const { from, to } = this.buildRange(query);
    const params: unknown[] = [tenantId, from, to];
    let clause = `${alias}.tenant_id = $1 AND ${alias}.deleted_at IS NULL AND ${alias}.payment_date BETWEEN $2 AND $3`;
    if (query.received_by_user_id) {
      params.push(query.received_by_user_id);
      clause += ` AND ${alias}.received_by_user_id = $${params.length}`;
    }
    if (query.payment_method) {
      params.push(query.payment_method);
      clause += ` AND ${alias}.payment_method = $${params.length}`;
    }
    return { clause, params };
  }

  async getReport(
    tenantId: string,
    query: CollectionsReportQueryDto,
  ): Promise<CollectionsReportDto> {
    const { from, to } = this.buildRange(query);
    const { clause, params } = this.buildFilter(tenantId, query, 'p');

    const totalsRow = await this.paymentRepo.manager.query<PaymentTotalsRow[]>(
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

    const discountRow = await this.paymentRepo.manager.query<DiscountTotalsRow[]>(
      `SELECT
         COALESCE(SUM(sf.standing_discount_amount * (pa.allocated_amount / NULLIF(sf.total_amount, 0))), 0) AS standing_discount,
         COALESCE(SUM(pa.discount_amount), 0) AS one_off_discount
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN student_fees sf ON sf.id = pa.student_fee_id
       WHERE ${clause}`,
      params,
    );

    const byMethod = await this.paymentRepo.manager.query<
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
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NOT NULL THEN p.total_amount ELSE 0 END), 0) AS reversed,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE -p.total_amount END), 0) AS net
       FROM payments p
       WHERE ${clause}
       GROUP BY p.payment_method
       ORDER BY p.payment_method`,
      params,
    );

    const byCollector = await this.paymentRepo.manager.query<
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
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NOT NULL THEN p.total_amount ELSE 0 END), 0) AS reversed,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE -p.total_amount END), 0) AS net
       FROM payments p
       LEFT JOIN users u ON u.id = p.received_by_user_id
       WHERE ${clause}
       GROUP BY p.received_by_user_id, u.full_name
       ORDER BY full_name NULLS LAST`,
      params,
    );

    const byFeeType = await this.paymentRepo.manager.query<
      Array<{ fee_type: string; collected: string; discount: string }>
    >(
      `SELECT
         fs.fee_type AS fee_type,
         COALESCE(SUM(pa.allocated_amount), 0) AS collected,
         COALESCE(
           SUM(pa.discount_amount)
             + SUM(sf.standing_discount_amount * (pa.allocated_amount / NULLIF(sf.total_amount, 0))),
           0
         ) AS discount
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN student_fees sf ON sf.id = pa.student_fee_id
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       WHERE ${clause}
       GROUP BY fs.fee_type
       ORDER BY fs.fee_type`,
      params,
    );

    const byDay = await this.paymentRepo.manager.query<
      Array<{ date: string; collected: string; reversed: string; net: string }>
    >(
      `SELECT
         (p.payment_date AT TIME ZONE '${SCHOOL_TIMEZONE}')::date::text AS date,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NOT NULL THEN p.total_amount ELSE 0 END), 0) AS reversed,
         COALESCE(SUM(CASE WHEN p.reversal_of_payment_id IS NULL THEN p.total_amount ELSE -p.total_amount END), 0) AS net
       FROM payments p
       WHERE ${clause}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

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
         p.payment_date AS date,
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
      date: new Date(r.date).toISOString(),
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
