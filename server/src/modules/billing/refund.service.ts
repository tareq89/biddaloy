import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  ApprovalScope,
  AuditAction,
  PlatformPaymentMethod,
  SeatOrderStatus,
  SmsBundleOrderStatus,
} from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { EntitlementService } from './entitlement.service';
import { MoneyNoticesService } from './money-notices.service';

/** The app never moves money (D25): the owner pays it back from the bKash panel. */
export const REFUND_NOTE = 'Pay money back bKash panel, done';

export interface RefundResult {
  applied: boolean;
  order_id: string;
  /** bKash transaction id to find the payment by; null for offline orders. */
  gateway_ref: string | null;
  note: string;
}

const notRefundable = () =>
  new ConflictException({
    message: 'This order cannot be refunded',
    details: { code: 'ORDER_NOT_REFUNDABLE' },
  });

/** [100.3.06] Refund of a seat order or an SMS package order. Coupon use is never returned (K7). */
@Injectable()
export class RefundService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly entitlement: EntitlementService,
    private readonly credits: SmsCreditService,
    private readonly audit: AuditService,
    private readonly notices: MoneyNoticesService,
  ) {}

  /** PAID -> REFUNDED, once. Later orders keep their periods (D44). A zero-amount order (grant or 100% coupon) has nothing to pay back: 409. */
  async refundSeatOrder(
    orderId: string,
    reason: string,
    actorUserId: string,
    approverId: string,
  ): Promise<RefundResult> {
    const out = await this.dataSource.transaction(async (m) => {
      // Same school lock `payInTx` takes: a refund and a payment never recompute at once.
      const [school]: { school_id: string }[] = await m.query(
        'SELECT school_id FROM seat_orders WHERE id = $1',
        [orderId],
      );
      if (!school) throw new NotFoundException('Order not found');
      await m.query('SELECT 1 FROM schools WHERE id = $1 FOR NO KEY UPDATE', [school.school_id]);
      const [rows]: [{ amount_paisa: string }[], number] = await m.query(
        `UPDATE seat_orders SET status = $2, refunded_at = now(), refund_reason = $3,
                refunded_by_user_id = $4
          WHERE id = $1 AND status = $5 AND unit_price_paisa > 0 AND amount_paisa > 0
          RETURNING amount_paisa::text AS amount_paisa`,
        [orderId, SeatOrderStatus.REFUNDED, reason, actorUserId, SeatOrderStatus.PAID],
      );
      if (!rows[0]) {
        const [cur]: { status: string }[] = await m.query(
          'SELECT status FROM seat_orders WHERE id = $1',
          [orderId],
        );
        if (cur?.status === SeatOrderStatus.REFUNDED)
          return { applied: false, schoolId: school.school_id };
        throw notRefundable();
      }
      await this.entitlement.recompute(school.school_id, m);
      await this.auditRefund(
        m,
        'School',
        orderId,
        school.school_id,
        rows[0].amount_paisa,
        reason,
        actorUserId,
        approverId,
      );
      return { applied: true, schoolId: school.school_id };
    });
    if (out.applied) {
      await this.entitlement.afterCommit(out.schoolId);
      await this.notices.refundDone(orderId);
    }
    return this.result(out.applied, orderId);
  }

  /** ACTIVE -> REFUNDED while no unit was taken. The lot is closed by `SmsCreditService`. */
  async refundBundleOrder(
    orderId: string,
    reason: string,
    actorUserId: string,
    approverId: string,
  ): Promise<RefundResult> {
    const out = await this.dataSource.transaction(async (m) => {
      const [order]: { school_id: string; status: string; price_paisa: string }[] = await m.query(
        'SELECT school_id, status, price_paisa::text AS price_paisa FROM sms_bundle_orders WHERE id = $1',
        [orderId],
      );
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === SmsBundleOrderStatus.REFUNDED) return { applied: false };
      if (order.status !== SmsBundleOrderStatus.ACTIVE) throw notRefundable();
      // Balance row then lot row (the `reserve` order): a reserve that got there first wins.
      const { closed } = await this.credits.closeUntouchedLot(m, order.school_id, orderId);
      if (!closed) return { applied: false };
      const [rows]: [{ id: string }[], number] = await m.query(
        `UPDATE sms_bundle_orders SET status = $2, refunded_at = now(), refund_reason = $3,
                refunded_by_user_id = $4
          WHERE id = $1 AND status = $5 RETURNING id`,
        [orderId, SmsBundleOrderStatus.REFUNDED, reason, actorUserId, SmsBundleOrderStatus.ACTIVE],
      );
      if (!rows[0]) throw notRefundable();
      await this.auditRefund(
        m,
        'School',
        orderId,
        order.school_id,
        order.price_paisa,
        reason,
        actorUserId,
        approverId,
      );
      return { applied: true };
    });
    if (out.applied) await this.notices.refundDone(orderId);
    return this.result(out.applied, orderId);
  }

  private auditRefund(
    m: EntityManager,
    entity: 'School',
    orderId: string,
    schoolId: string,
    amountPaisa: string,
    reason: string,
    actorUserId: string,
    approverId: string,
  ) {
    return this.audit.recordApproved(
      {
        action: AuditAction.ORDER_REFUNDED,
        entity_type: entity,
        entity_id: schoolId,
        tenant_id: schoolId,
        performed_by_user_id: actorUserId,
        new_values: { order_id: orderId, amount_paisa: amountPaisa, reason },
        approved_by_user_id: approverId,
        approval_scope: ApprovalScope.PLATFORM_REFUND,
      },
      m,
    );
  }

  /** An order id lives in one table only, so one OR-query finds its bKash payment. */
  private async result(applied: boolean, orderId: string): Promise<RefundResult> {
    const [p]: { gateway_ref: string | null }[] = await this.dataSource.query(
      `SELECT gateway_ref FROM platform_payments
        WHERE (seat_order_id = $1 OR bundle_order_id = $1)
          AND method = $2 AND (raw->>'orphan') IS DISTINCT FROM 'true'
        ORDER BY created_at DESC LIMIT 1`,
      [orderId, PlatformPaymentMethod.BKASH],
    );
    return { applied, order_id: orderId, gateway_ref: p?.gateway_ref ?? null, note: REFUND_NOTE };
  }
}
