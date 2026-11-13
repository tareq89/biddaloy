import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  PlatformPaymentMethod,
  SeatOrderStatus,
  type OrderPreviewResponse,
  type SeatOrderDto,
} from '@biddaloy/shared';
import {
  CouponRedemptionService,
  couponNotValid,
  normaliseCouponCode,
} from '../coupons/coupon-redemption.service';
import { PlansService } from '../plans/plans.service';
import { EntitlementService } from './entitlement.service';
import { MoneyNoticesService } from './money-notices.service';
import { buildReceiptSnapshot } from './receipt-snapshot';
import { VatService } from './vat.service';
import { nextReceiptNumber } from './receipt-number.util';
import { ReceiptService } from './receipt.service';

/** The old flat price; pricing now comes from the school's plan (kept for the DTO spec). */
export const SEAT_UNIT_PRICE_PAISA = 1000;
/** Rule 5: bounds checked here as well as in the DTO, and by CHECK constraints. */
export const MAX_ORDER_SEATS = 100000;

export interface CreatePendingInput {
  schoolId: string;
  seats: number;
  months: number;
  idempotency_key: string;
  userId: string | null;
  /** Defaults to the school's plan price; a platform GRANT passes 0 and never takes a coupon. */
  unit_price_paisa?: number;
  coupon_code?: string | null;
}

export interface PaymentInput {
  method: PlatformPaymentMethod;
  gateway_ref?: string | null;
  /** Defaults to the order amount (a GRANT passes '0'). */
  amount_paisa?: string;
  raw?: Record<string, unknown> | null;
  recordedByUserId?: string | null;
  /** Runs inside the payment transaction, only when this call applied the payment. */
  onApplied?: (manager: EntityManager) => Promise<void>;
}

interface OrderRow {
  id: string;
  school_id: string;
  seats: number;
  months: number;
  unit_price_paisa: number;
  amount_paisa: string;
  period_start: string;
  period_end: string;
  status: SeatOrderStatus;
  method: PlatformPaymentMethod | null;
  receipt_number: string | null;
  paid_at: Date | null;
  created_at: Date;
  plan_id: string | null;
  discount_paisa: string;
  coupon_id: string | null;
  coupon_code: string | null;
}

/** Shared by the replay lookup and `list`. */
const ORDER_SELECT = `SELECT o.id, o.school_id, o.seats, o.months, o.unit_price_paisa, o.amount_paisa,
  o.period_start::text AS period_start, o.period_end::text AS period_end, o.status,
  (SELECT p.method FROM platform_payments p WHERE p.seat_order_id = o.id
    AND (p.raw->>'orphan') IS DISTINCT FROM 'true' ORDER BY p.created_at DESC LIMIT 1) AS method,
  o.receipt_number, o.paid_at, o.created_at, o.plan_id, o.discount_paisa, o.coupon_id,
  c.code AS coupon_code
  FROM seat_orders o LEFT JOIN coupons c ON c.id = o.coupon_id`;

function toDto(r: OrderRow): SeatOrderDto {
  const { coupon_id: _couponId, ...rest } = r;
  return {
    ...rest,
    amount_paisa: Number(r.amount_paisa),
    discount_paisa: Number(r.discount_paisa),
    list_unit_price_paisa: r.unit_price_paisa,
    paid_at: r.paid_at ? r.paid_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly entitlement: EntitlementService,
    private readonly receipts: ReceiptService,
    private readonly plans: PlansService,
    private readonly coupons: CouponRedemptionService,
    private readonly vat: VatService,
    private readonly moneyNotices: MoneyNoticesService,
  ) {}

  private assertRange(seats: number, months: number): void {
    if (
      !Number.isInteger(seats) ||
      seats < 1 ||
      seats > MAX_ORDER_SEATS ||
      !Number.isInteger(months) ||
      months < 1 ||
      months > 24
    ) {
      throw new BadRequestException({
        message: 'Seats or months out of range',
        details: { code: 'ORDER_OUT_OF_RANGE' },
      });
    }
  }

  /** No write, no use consumed. A bad code is the one coupon sentence and counts as a wrong try. */
  async preview(
    schoolId: string,
    input: { seats: number; months: number; coupon_code?: string | null },
  ): Promise<OrderPreviewResponse> {
    this.assertRange(input.seats, input.months);
    const { unitPricePaisa } = await this.plans.priceFor(schoolId);
    const list = input.seats * input.months * unitPricePaisa;
    const discount = input.coupon_code
      ? (
          await this.coupons.preview({
            schoolId,
            code: input.coupon_code,
            seats: input.seats,
            months: input.months,
            unitPaisa: unitPricePaisa,
          })
        ).discountPaisa
      : 0;
    const total = list - discount;
    return {
      listAmountPaisa: list,
      discountPaisa: discount,
      totalPaisa: total,
      free: total === 0,
      unit_price_paisa: unitPricePaisa,
      status: total === 0 ? SeatOrderStatus.PAID : SeatOrderStatus.PENDING,
    };
  }

  /**
   * Same (school, idempotency_key), seats, months and coupon returns the first order untouched
   * (no second use); any difference is 409 IDEMPOTENCY_KEY_REUSED. A 100 percent coupon is paid in
   * the same transaction: no bKash step, a numbered receipt marked COUPON.
   */
  async createPending(input: CreatePendingInput): Promise<SeatOrderDto> {
    const r = await this.dataSource.transaction((m) => this.insertPending(m, input));
    if (r.freePaid) {
      void this.receipts.emailReceipt(r.order.id);
      await this.entitlement.afterCommit(input.schoolId);
    }
    if (r.redeemed) void this.moneyNotices.couponApplied(r.order.id);
    return r.order;
  }

  private async findByKey(m: EntityManager, schoolId: string, key: string): Promise<OrderRow> {
    const [row]: OrderRow[] = await m.query(
      `${ORDER_SELECT} WHERE o.school_id = $1 AND o.idempotency_key = $2`,
      [schoolId, key],
    );
    return row;
  }

  /** A replay must be the same order; a different body on a used key is a client bug (Rule 23: fixed text). */
  private async assertSameOrder(
    m: EntityManager,
    row: OrderRow,
    input: CreatePendingInput,
  ): Promise<void> {
    const code = input.coupon_code ? normaliseCouponCode(input.coupon_code) : null;
    // Resolved to an id so "save10" and "SAVE10" are the same coupon; no limiter, no redeem.
    let couponId: string | null = null;
    if (code) {
      const [c]: { id: string }[] = await m.query('SELECT id FROM coupons WHERE code = $1', [code]);
      couponId = c?.id ?? null;
    }
    const sameCoupon = input.coupon_code
      ? couponId !== null && couponId === row.coupon_id
      : row.coupon_id === null;
    if (row.seats !== input.seats || row.months !== input.months || !sameCoupon) {
      throw new ConflictException({
        message: 'This idempotency key was already used for a different order',
        details: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
    }
  }

  private async insertPending(
    m: EntityManager,
    input: CreatePendingInput,
  ): Promise<{ order: SeatOrderDto; redeemed: boolean; freePaid: boolean }> {
    this.assertRange(input.seats, input.months);
    // A replay is answered before any coupon work: a used-up coupon must not turn it into a 400.
    const existing = await this.findByKey(m, input.schoolId, input.idempotency_key);
    if (existing) {
      await this.assertSameOrder(m, existing, input);
      return { order: toDto(existing), redeemed: false, freePaid: false };
    }
    const isGrant = input.unit_price_paisa !== undefined;
    const price = isGrant ? null : await this.plans.priceFor(input.schoolId, m);
    const unit = input.unit_price_paisa ?? price!.unitPricePaisa;
    const list = input.seats * input.months * unit;
    const code = !isGrant && input.coupon_code ? input.coupon_code : null;
    let couponId: string | null = null;
    let discount = 0;
    if (code) {
      // Preview first (reads only): the order row must carry the final numbers (CHECK), and
      // `redeemInTx` needs the order row to exist.
      const p = await this.coupons.preview({
        schoolId: input.schoolId,
        code,
        seats: input.seats,
        months: input.months,
        unitPaisa: unit,
      });
      couponId = p.couponId;
      discount = p.discountPaisa;
    }
    const amount = list - discount;
    // The period shown on a PENDING order is a preview, by the same rule; payInTx sets the real one.
    const start = await this.startDate(m, input.schoolId, input.seats, unit > 0);
    // INSERT answers bare rows in TypeORM; none means a concurrent replay won the key.
    const inserted: { id: string }[] = await m.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa,
                                period_start, period_end, status, idempotency_key, created_by_user_id,
                                plan_id, coupon_id, discount_paisa)
       VALUES ($1, $2, $3, $4, $5, $9::date, $9::date + ($3::int * interval '1 month'), $6, $7, $8,
               $10, $11, $12)
       ON CONFLICT (school_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.schoolId,
        input.seats,
        input.months,
        unit,
        amount,
        SeatOrderStatus.PENDING,
        input.idempotency_key,
        input.userId,
        start,
        price?.planId ?? null,
        couponId,
        discount,
      ],
    );
    if (inserted.length === 0) {
      const row = await this.findByKey(m, input.schoolId, input.idempotency_key);
      await this.assertSameOrder(m, row, input);
      return { order: toDto(row), redeemed: false, freePaid: false };
    }
    const id = inserted[0].id;
    if (code) {
      await this.coupons.redeemInTx(m, {
        schoolId: input.schoolId,
        code,
        seats: input.seats,
        months: input.months,
        unitPaisa: unit,
        seatOrderId: id,
        discountPaisa: discount,
      });
    }
    let freePaid = false;
    if (code && amount === 0) {
      const paid = await this.payInTx(m, id, {
        method: PlatformPaymentMethod.COUPON,
        amount_paisa: '0',
      });
      freePaid = paid.applied;
    }
    const row = await this.findByKey(m, input.schoolId, input.idempotency_key);
    return { order: toDto(row), redeemed: code !== null, freePaid };
  }

  /** Create and pay in one transaction (platform grant): no PENDING order is left behind on failure. */
  async createPaid(input: CreatePendingInput, payment: PaymentInput): Promise<SeatOrderDto> {
    const result = await this.dataSource.transaction(async (m) => {
      const { order } = await this.insertPending(m, input);
      const paid = await this.payInTx(m, order.id, payment);
      return { order, paid };
    });
    if (result.paid.applied) await this.entitlement.afterCommit(input.schoolId);
    return result.order;
  }

  /**
   * PENDING -> PAID, once. The conditional UPDATE is the idempotency guard: a replay matches no
   * row, records no second payment and does not recompute. The period is set at payment time so an
   * order paid late still covers the months bought. See `startDate` for where the period starts.
   */
  async markPaid(orderId: string, payment: PaymentInput): Promise<{ applied: boolean }> {
    const result = await this.dataSource.transaction((m) => this.payInTx(m, orderId, payment));
    if (result.applied) {
      // Never fails the payment: the receipt stays downloadable even if the email does not go.
      void this.receipts.emailReceipt(orderId);
      await this.entitlement.afterCommit(result.schoolId);
    }
    return { applied: result.applied };
  }

  private async payInTx(
    m: EntityManager,
    orderId: string,
    payment: PaymentInput,
  ): Promise<{ applied: false } | { applied: true; schoolId: string }> {
    {
      // Two payments for one school at once must not both read the same cover.
      await m.query(
        'SELECT 1 FROM schools WHERE id = (SELECT school_id FROM seat_orders WHERE id = $1) FOR NO KEY UPDATE',
        [orderId],
      );
      const [order]: {
        school_id: string;
        seats: number;
        discount_paisa: string;
        coupon_code: string | null;
      }[] = await m.query(
        `SELECT o.school_id, o.seats, o.discount_paisa, c.code AS coupon_code
           FROM seat_orders o LEFT JOIN coupons c ON c.id = o.coupon_id WHERE o.id = $1`,
        [orderId],
      );
      if (!order) throw new NotFoundException('Order not found');
      const start = await this.startDate(
        m,
        order.school_id,
        order.seats,
        payment.method !== PlatformPaymentMethod.GRANT,
      );
      // TypeORM returns `[rows, affectedCount]` for UPDATE ... RETURNING.
      const [rows]: [{ id: string; school_id: string; amount_paisa: string }[], number] =
        await m.query(
          `UPDATE seat_orders o
            SET status = $2, paid_at = now(), period_start = $4::date,
                period_end = $4::date + (o.months * interval '1 month')
          WHERE o.id = $1 AND o.status = $3
          RETURNING o.id, o.school_id, o.amount_paisa`,
          [orderId, SeatOrderStatus.PAID, SeatOrderStatus.PENDING, start],
        );
      const paid = rows[0];
      if (!paid) return { applied: false as const };
      await m.query(
        `INSERT INTO platform_payments (seat_order_id, method, gateway_ref, amount_paisa, raw, recorded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orderId,
          payment.method,
          payment.gateway_ref ?? null,
          payment.amount_paisa ?? paid.amount_paisa,
          payment.raw ? JSON.stringify(payment.raw) : null,
          payment.recordedByUserId ?? null,
        ],
      );
      // A GRANT is a zero-value platform gift, not a sale: no receipt.
      if (payment.method !== PlatformPaymentMethod.GRANT) {
        const [school]: { name: string; address: string | null }[] = await m.query(
          'SELECT name, address FROM schools WHERE id = $1',
          [paid.school_id],
        );
        const snapshot = buildReceiptSnapshot(
          school,
          await this.vat.get(),
          Number(payment.amount_paisa ?? paid.amount_paisa),
          order.coupon_code
            ? { coupon_code: order.coupon_code, discount_paisa: Number(order.discount_paisa) }
            : {},
        );
        await m.query(
          'UPDATE seat_orders SET receipt_number = $2, receipt_snapshot = $3::jsonb WHERE id = $1',
          [orderId, await nextReceiptNumber(m), JSON.stringify(snapshot)],
        );
      }
      await this.entitlement.recompute(paid.school_id, m);
      await payment.onApplied?.(m);
      return { applied: true as const, schoolId: paid.school_id };
    }
  }

  /** Just what a payment gateway needs to check an order; undefined for an unknown id. */
  async findForPayment(
    orderId: string,
  ): Promise<
    { id: string; school_id: string; amount_paisa: string; status: SeatOrderStatus } | undefined
  > {
    const [row] = await this.dataSource.query(
      'SELECT id, school_id, amount_paisa, status FROM seat_orders WHERE id = $1',
      [orderId],
    );
    return row;
  }

  /** PENDING -> FAILED, only while nothing was charged (a gateway create that never started). */
  async markFailed(orderId: string): Promise<void> {
    await this.dataSource.query(
      'UPDATE seat_orders SET status = $2 WHERE id = $1 AND status = $3',
      [orderId, SeatOrderStatus.FAILED, SeatOrderStatus.PENDING],
    );
  }

  /**
   * First day (YYYY-MM-DD, school time) of an order's period. A GRANT (`chains` false) starts
   * today and adds seats. A purchase looks at the school's own cover: its largest PAID order that
   * has not ended (GRANTs, unit price 0, never count, so a long grant cannot push a renewal out).
   * Seats >= that order's seats: a renewal or upgrade, it starts where that order ends, so an early
   * renewal never overlaps. Fewer seats: a top-up, it starts today and adds to the seats in force,
   * so a small mid-period buy does not push the next renewal out. No cover: today.
   */
  private async startDate(
    m: EntityManager,
    schoolId: string,
    seats: number,
    chains: boolean,
  ): Promise<string> {
    const [row]: { start: string }[] = await m.query(
      `SELECT (CASE WHEN $3::boolean AND c.seats <= $2 THEN c.period_end ELSE t.today END)::text AS start
         FROM (SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date AS today) t
         LEFT JOIN LATERAL (
           SELECT p.seats, p.period_end FROM seat_orders p
            WHERE p.school_id = $1 AND p.status = $4 AND p.unit_price_paisa > 0
              AND p.period_end > t.today
            ORDER BY p.seats DESC, p.period_end DESC LIMIT 1) c ON true`,
      [schoolId, seats, chains, SeatOrderStatus.PAID],
    );
    return row.start;
  }

  async list(schoolId: string, limit: number, offset = 0): Promise<SeatOrderDto[]> {
    const rows: OrderRow[] = await this.dataSource.query(
      `${ORDER_SELECT} WHERE o.school_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [schoolId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
    );
    return rows.map(toDto);
  }
}
