import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformPaymentMethod, SmsBundleOrderStatus as S } from '@biddaloy/shared';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import { ReceiptService } from '../../billing/receipt.service';
import { nextReceiptNumber } from '../../billing/receipt-number.util';
import { SmsAllocationService } from '../stock/sms-allocation.service';
import { canMove } from '../orders/sms-bundle-orders.service';

export interface BundlePaymentInput {
  method: PlatformPaymentMethod;
  gateway_ref?: string | null;
  /** Defaults to the order price. */
  amount_paisa?: string;
  raw?: Record<string, unknown> | null;
  recordedByUserId?: string | null;
  /** Runs inside the payment transaction, only when this call applied the payment. */
  onApplied?: (manager: EntityManager) => Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SmsBundlePaymentService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly credits: SmsCreditService,
    private readonly allocation: SmsAllocationService,
    private readonly receipts: ReceiptService,
  ) {}

  /** Just what a payment route needs; undefined for an unknown id. */
  async findForPayment(
    orderId: string,
  ): Promise<{ id: string; school_id: string; status: S } | undefined> {
    const [row] = await this.ds.query(
      'SELECT id, school_id, status FROM sms_bundle_orders WHERE id = $1',
      [orderId],
    );
    return row;
  }

  /**
   * D8: a NEW package payment is refused while oversold (same sentence as order create). Called
   * before a payment starts, never inside `markPaid`: money already taken is never refused.
   */
  async assertSalesOpen(): Promise<void> {
    if (await this.allocation.isOversold()) {
      throw new ConflictException({
        message: 'SMS sales are paused for now',
        details: { code: 'SMS_SALES_PAUSED' },
      });
    }
  }

  /**
   * PENDING_PAYMENT -> PAID -> ACTIVE, once, in one transaction: payment row, one lot (idempotency
   * key = order id), ACTIVE, receipt number. A failure anywhere rolls all of it back. A replay, or
   * an order that is not PENDING_PAYMENT (cancelled, paid), returns `applied: false` and changes
   * nothing. `manager` joins the caller's transaction.
   */
  async markPaid(
    orderId: string,
    payment: BundlePaymentInput,
    manager?: EntityManager,
  ): Promise<{ applied: boolean }> {
    const run = async (m: EntityManager) => {
      const [order]: {
        school_id: string;
        status: S;
        sms_count: number;
        validity_days: number;
        price_paisa: string;
      }[] = await m.query(
        `SELECT school_id, status, sms_count, validity_days, price_paisa::text AS price_paisa
           FROM sms_bundle_orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      if (!order) throw new NotFoundException('Order not found');
      if (!canMove(order.status, S.PAID)) return { applied: false };
      await m.query(
        `INSERT INTO platform_payments (bundle_order_id, method, gateway_ref, amount_paisa, raw, recorded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orderId,
          payment.method,
          payment.gateway_ref ?? null,
          payment.amount_paisa ?? order.price_paisa,
          payment.raw ? JSON.stringify(payment.raw) : null,
          payment.recordedByUserId ?? null,
        ],
      );
      await m.query(
        `UPDATE sms_bundle_orders SET status = $2, paid_at = now(), updated_at = now() WHERE id = $1`,
        [orderId, S.PAID],
      );
      await this.credits.purchase(
        order.school_id,
        {
          bundleOrderId: orderId,
          units: order.sms_count,
          expiresAt: new Date(Date.now() + order.validity_days * DAY_MS),
          idempotencyKey: orderId,
        },
        { manager: m },
      );
      await m.query(
        `UPDATE sms_bundle_orders SET status = $2, receipt_number = $3,
           receipt_snapshot = (SELECT jsonb_build_object('name', s.name, 'address', s.address, 'vat', $4::text)
                                 FROM schools s WHERE s.id = sms_bundle_orders.school_id),
           updated_at = now()
         WHERE id = $1`,
        [
          orderId,
          S.ACTIVE,
          await nextReceiptNumber(m),
          process.env.BILLING_VAT_REGISTRATION?.trim() || null,
        ],
      );
      await payment.onApplied?.(m);
      return { applied: true };
    };
    if (manager) return run(manager); // the caller owns the commit, so it sends the email
    const res = await this.ds.transaction(run);
    // After commit; emailReceipt never throws, so the payment is never failed by the email.
    if (res.applied) await this.receipts.emailReceipt(orderId);
    return res;
  }
}
