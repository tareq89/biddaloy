import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformPaymentMethod, SeatOrderStatus, type SeatOrderDto } from '@biddaloy/shared';
import { EntitlementService } from './entitlement.service';

/** D2: 1000 paisa (BDT 10) per seat per month. */
export const SEAT_UNIT_PRICE_PAISA = 1000;
/** Rule 5: bounds checked here as well as in the DTO, and by CHECK constraints. */
export const MAX_ORDER_SEATS = 100000;

export interface CreatePendingInput {
  schoolId: string;
  seats: number;
  months: number;
  idempotency_key: string;
  userId: string | null;
  /** Defaults to 1000; a platform GRANT passes 0. */
  unit_price_paisa?: number;
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
  paid_at: Date | null;
  created_at: Date;
}

function toDto(r: OrderRow): SeatOrderDto {
  return {
    ...r,
    amount_paisa: Number(r.amount_paisa),
    paid_at: r.paid_at ? r.paid_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly entitlement: EntitlementService,
  ) {}

  /** Same (school, idempotency_key) returns the first order untouched. */
  async createPending(input: CreatePendingInput): Promise<SeatOrderDto> {
    return this.insertPending(this.dataSource.manager, input);
  }

  private async insertPending(m: EntityManager, input: CreatePendingInput): Promise<SeatOrderDto> {
    if (
      !Number.isInteger(input.seats) ||
      input.seats < 1 ||
      input.seats > MAX_ORDER_SEATS ||
      !Number.isInteger(input.months) ||
      input.months < 1 ||
      input.months > 24
    ) {
      throw new BadRequestException({
        message: 'Seats or months out of range',
        details: { code: 'ORDER_OUT_OF_RANGE' },
      });
    }
    const unit = input.unit_price_paisa ?? SEAT_UNIT_PRICE_PAISA;
    const amount = input.seats * input.months * unit;
    // The period shown on a PENDING order is a preview; payInTx sets the real one.
    await m.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa,
                                period_start, period_end, status, idempotency_key, created_by_user_id)
       SELECT $1, $2, $3, $4, $5, s.start, s.start + ($3::int * interval '1 month'), $6, $7, $8
         FROM (SELECT GREATEST((now() AT TIME ZONE 'Asia/Dhaka')::date,
                 (SELECT MAX(p.period_end) FROM seat_orders p
                   WHERE p.school_id = $1 AND p.status = $9)) AS start) s
       ON CONFLICT (school_id, idempotency_key) DO NOTHING`,
      [
        input.schoolId,
        input.seats,
        input.months,
        unit,
        amount,
        SeatOrderStatus.PENDING,
        input.idempotency_key,
        input.userId,
        SeatOrderStatus.PAID,
      ],
    );
    const [row]: OrderRow[] = await m.query(
      `SELECT o.id, o.school_id, o.seats, o.months, o.unit_price_paisa, o.amount_paisa,
  o.period_start::text AS period_start, o.period_end::text AS period_end, o.status,
  (SELECT p.method FROM platform_payments p WHERE p.seat_order_id = o.id
    ORDER BY p.created_at DESC LIMIT 1) AS method,
  o.paid_at, o.created_at FROM seat_orders o WHERE o.school_id = $1 AND o.idempotency_key = $2`,
      [input.schoolId, input.idempotency_key],
    );
    return toDto(row);
  }

  /** Create and pay in one transaction (platform grant): no PENDING order is left behind on failure. */
  async createPaid(input: CreatePendingInput, payment: PaymentInput): Promise<SeatOrderDto> {
    const result = await this.dataSource.transaction(async (m) => {
      const order = await this.insertPending(m, input);
      const paid = await this.payInTx(m, order.id, payment);
      return { order, paid };
    });
    if (result.paid.applied) await this.entitlement.afterCommit(input.schoolId);
    return result.order;
  }

  /**
   * PENDING -> PAID, once. The conditional UPDATE is the idempotency guard: a replay matches no
   * row, records no second payment and does not recompute. The period is set at payment time so an
   * order paid late still covers the months bought, and it starts where the school's last PAID
   * period ends (or today if that is past): an early renewal extends, it never overlaps.
   */
  async markPaid(orderId: string, payment: PaymentInput): Promise<{ applied: boolean }> {
    const result = await this.dataSource.transaction((m) => this.payInTx(m, orderId, payment));
    if (result.applied) await this.entitlement.afterCommit(result.schoolId);
    return { applied: result.applied };
  }

  private async payInTx(
    m: EntityManager,
    orderId: string,
    payment: PaymentInput,
  ): Promise<{ applied: false } | { applied: true; schoolId: string }> {
    {
      // Two payments for one school at once must not both read the same last period end.
      await m.query(
        'SELECT 1 FROM schools WHERE id = (SELECT school_id FROM seat_orders WHERE id = $1) FOR NO KEY UPDATE',
        [orderId],
      );
      // TypeORM returns `[rows, affectedCount]` for UPDATE ... RETURNING.
      const [rows]: [{ id: string; school_id: string; amount_paisa: string }[], number] =
        await m.query(
          `UPDATE seat_orders o
            SET status = $2, paid_at = now(), period_start = s.start,
                period_end = s.start + (o.months * interval '1 month')
           FROM (SELECT GREATEST((now() AT TIME ZONE 'Asia/Dhaka')::date,
                   (SELECT MAX(p.period_end) FROM seat_orders p
                     WHERE p.school_id = (SELECT school_id FROM seat_orders WHERE id = $1)
                       AND p.status = $2)) AS start) s
          WHERE o.id = $1 AND o.status = $3
          RETURNING o.id, o.school_id, o.amount_paisa`,
          [orderId, SeatOrderStatus.PAID, SeatOrderStatus.PENDING],
        );
      const paid = rows[0];
      if (!paid) {
        const exists = await m.query('SELECT 1 FROM seat_orders WHERE id = $1', [orderId]);
        if (!exists.length) throw new NotFoundException('Order not found');
        return { applied: false as const };
      }
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
      await this.entitlement.recompute(paid.school_id, m);
      await payment.onApplied?.(m);
      return { applied: true as const, schoolId: paid.school_id };
    }
  }

  async list(schoolId: string, limit: number, offset = 0): Promise<SeatOrderDto[]> {
    const rows: OrderRow[] = await this.dataSource.query(
      `SELECT o.id, o.school_id, o.seats, o.months, o.unit_price_paisa, o.amount_paisa,
  o.period_start::text AS period_start, o.period_end::text AS period_end, o.status,
  (SELECT p.method FROM platform_payments p WHERE p.seat_order_id = o.id
    ORDER BY p.created_at DESC LIMIT 1) AS method,
  o.paid_at, o.created_at FROM seat_orders o WHERE o.school_id = $1
        ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [schoolId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
    );
    return rows.map(toDto);
  }
}
