import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  IDLE_REASON,
  SeatOrderStatus,
  SmsBundleOrderStatus,
  PlatformPaymentMethod,
  type PlatformSchoolBilling,
  type SmsBundleOrderDto,
  type PlatformSchoolBillingPage,
  type PlatformSchoolBillingDetail,
  type SchoolBillingFilter,
} from '@biddaloy/shared';
import { SCHOOL_TZ, localDate } from '../../common/time';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { AuditService } from '../audit/audit.service';
import { TrialService } from '../schools/trial/trial.service';
import { OrdersService } from './orders.service';
import { BkashService } from './bkash/bkash.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { SmsBundlePaymentService } from '../sms-bundles/payment/sms-bundle-payment.service';
import type { GrantSeatsDto, OfflinePaymentDto } from './dto/platform-billing.dto';

/** "Expiring" window of the platform list. */
export const EXPIRING_WITHIN_DAYS = 14;

/**
 * One row per school; entitled / used / paid-until are correlated subqueries. Static text on
 * purpose (Rule 4): every value is a bind parameter, the optional filters are `$n IS NULL OR ...`.
 * $1 PAID, $2 today, $3 ACTIVE student, $4 PENDING, $5 name pattern, $6 filter, $7 IDLE reason,
 * $8 expiring-until date, $9 school id, $10 limit, $11 offset.
 * "Exhausted" = every seat used, by the limit (a blocked limit of 0 counts) or by the paid seats.
 * paid_until is the school's own orders' end; a GRANT's (unit price 0) only with no own order.
 */
const SCHOOLS_SQL = `
SELECT t.*, count(*) OVER()::int AS total FROM (
  SELECT s.id, s.name, s.status, s.status_reason, (s.deleted_at IS NOT NULL) AS deleted, s.seat_limit,
    COALESCE((SELECT SUM(o.seats) FROM seat_orders o WHERE o.school_id = s.id AND o.status = $1
               AND o.period_start <= $2::date AND o.period_end > $2::date), 0)::int AS seats_entitled,
    (SELECT count(*) FROM students st WHERE st.tenant_id = s.id AND st.deleted_at IS NULL
       AND st.enrollment_status = $3)::int AS seats_used,
    (SELECT (COALESCE(max(o.period_end) FILTER (WHERE o.unit_price_paisa > 0), max(o.period_end)) - 1)::text
       FROM seat_orders o WHERE o.school_id = s.id AND o.status = $1) AS paid_until,
    (SELECT count(*) FROM seat_orders o WHERE o.school_id = s.id AND o.status = $4)::int AS pending_orders
  FROM schools s
) t
WHERE ($9::uuid IS NULL OR t.id = $9::uuid)
  AND ($5::text IS NULL OR t.name ILIKE $5::text)
  AND ($6::text IS NULL
    OR ($6 = 'idle' AND t.status_reason = $7)
    OR ($6 = 'exhausted' AND ((t.seat_limit IS NOT NULL AND t.seats_used >= t.seat_limit)
                              OR (t.seats_entitled > 0 AND t.seats_used >= t.seats_entitled)))
    OR ($6 = 'expiring' AND t.paid_until IS NOT NULL AND t.paid_until::date >= $2::date
                        AND t.paid_until::date <= $8::date))
ORDER BY t.name ASC, t.id ASC LIMIT $10 OFFSET $11`;

type BundleOrderRow = SmsBundleOrderDto & {
  refunded_at: string | null;
  units_bought: number;
  units_used: number;
  refundable: boolean;
};

type SchoolDetail = PlatformSchoolBillingDetail & {
  plan: { id: string; name: string; unit_price_paisa: number } | null;
  bundle_orders: BundleOrderRow[];
};

type SchoolRow = PlatformSchoolBilling & { seat_limit: number | null; total: number };

@Injectable()
export class PlatformBillingService {
  private readonly logger = new Logger(PlatformBillingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
    private readonly bkash: BkashService,
  ) {}

  private async query(
    now: Date,
    o: {
      search?: string;
      filter?: SchoolBillingFilter;
      id?: string;
      limit: number;
      offset: number;
    },
  ): Promise<SchoolRow[]> {
    const term = normalizeSearchTerm(o.search);
    return this.dataSource.query(SCHOOLS_SQL, [
      SeatOrderStatus.PAID,
      localDate(now, SCHOOL_TZ),
      EnrollmentStatus.ACTIVE,
      SeatOrderStatus.PENDING,
      term ? `%${term}%` : null,
      o.filter ?? null,
      IDLE_REASON,
      localDate(new Date(now.getTime() + EXPIRING_WITHIN_DAYS * 86_400_000), SCHOOL_TZ),
      o.id ?? null,
      o.limit,
      o.offset,
    ]);
  }

  async listSchools(
    q: { search?: string; filter?: SchoolBillingFilter; limit?: number; offset?: number },
    now = new Date(),
  ): Promise<PlatformSchoolBillingPage> {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const rows = await this.query(now, { ...q, limit, offset: Math.max(q.offset ?? 0, 0) });
    return {
      items: rows.map(({ total: _t, seat_limit: _s, ...row }) => row),
      total: rows[0]?.total ?? 0,
    };
  }

  async schoolDetail(schoolId: string, now = new Date()): Promise<SchoolDetail> {
    const [row] = await this.query(now, { id: schoolId, limit: 1, offset: 0 });
    if (!row) throw new NotFoundException('School not found');
    const { total: _t, seat_limit: _s, ...school } = row;
    const orders = await this.orders.list(schoolId, 100);
    // refunded_at is read here so OrdersService (the school's own list) stays unchanged.
    const refunded: { id: string; refunded_at: Date }[] = await this.dataSource.query(
      'SELECT id, refunded_at FROM seat_orders WHERE school_id = $1 AND refunded_at IS NOT NULL',
      [schoolId],
    );
    const refundedAt = new Map(refunded.map((r) => [r.id, r.refunded_at.toISOString()]));
    const [plan]: { id: string; name: string; unit_price_paisa: number }[] =
      await this.dataSource.query(
        `SELECT p.id, p.name, p.unit_price_paisa FROM schools s
           JOIN plans p ON p.id = s.plan_id WHERE s.id = $1`,
        [schoolId],
      );
    return {
      ...school,
      plan: plan ?? null,
      orders: orders.map((o) => ({ ...o, refunded_at: refundedAt.get(o.id) ?? null })),
      bundle_orders: await this.bundleOrders(schoolId),
    };
  }

  /** The school's package orders. `refundable` = ACTIVE and its lot untouched (a read through the
   * credit service: this file never names the credit tables). */
  private async bundleOrders(schoolId: string): Promise<BundleOrderRow[]> {
    const rows: {
      id: string;
      catalog_id: string;
      name_snapshot: string;
      sms_count: number;
      price_paisa: string;
      status: SmsBundleOrderStatus;
      receipt_number: string | null;
      paid_at: Date | null;
      created_at: Date;
      refunded_at: Date | null;
      method: PlatformPaymentMethod | null;
    }[] = await this.dataSource.query(
      `SELECT o.id, o.catalog_id, o.name_snapshot, o.sms_count, o.price_paisa::text AS price_paisa,
              o.status, o.receipt_number, o.paid_at, o.created_at, o.refunded_at,
              (SELECT p.method FROM platform_payments p WHERE p.bundle_order_id = o.id
                AND (p.raw->>'orphan') IS DISTINCT FROM 'true' ORDER BY p.created_at DESC LIMIT 1) AS method,
              o.sms_count AS units_bought
         FROM sms_bundle_orders o WHERE o.school_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
      [schoolId],
    );
    const credits = this.moduleRef.get(SmsCreditService, { strict: false });
    const lots = await credits.bundleLotUsage(rows.map((r) => r.id));
    return rows.map((r) => {
      const lot = lots.get(r.id);
      return {
        id: r.id,
        school_id: schoolId,
        bundle_id: r.catalog_id,
        bundle_name: r.name_snapshot,
        sms_count: r.sms_count,
        amount_paisa: Number(r.price_paisa),
        status: r.status,
        method: r.method,
        receipt_number: r.receipt_number,
        paid_at: r.paid_at ? r.paid_at.toISOString() : null,
        expires_at: lot?.expiresAt ? lot.expiresAt.toISOString() : null,
        created_at: r.created_at.toISOString(),
        refunded_at: r.refunded_at ? r.refunded_at.toISOString() : null,
        units_bought: r.sms_count,
        units_used: lot?.used ?? 0,
        refundable: r.status === SmsBundleOrderStatus.ACTIVE && lot?.untouched === true,
      };
    });
  }

  /**
   * PENDING -> PAID with an offline method. A replay (order already paid) records nothing and
   * returns `applied: false`; the audit row commits in the payment transaction.
   */
  async recordOfflinePayment(orderId: string, dto: OfflinePaymentDto, actorUserId: string) {
    const order = await this.orders.findForPayment(orderId);
    if (!order) throw new NotFoundException('Order not found');
    // Already paid: a replay, nothing to do. FAILED / CANCELLED / REFUNDED can never be paid.
    if (order.status === SeatOrderStatus.PAID)
      return { applied: false, school_id: order.school_id };
    if (order.status !== SeatOrderStatus.PENDING) {
      throw new ConflictException({
        message: 'This order cannot be paid',
        details: { code: 'ORDER_NOT_PENDING' },
      });
    }
    // A bKash payment for this order may still complete: paying it offline too would charge twice.
    // Redis down: we cannot tell, so refuse (fail closed) rather than risk it.
    await this.assertNoLiveBkash(orderId);
    try {
      const { applied } = await this.orders.markPaid(orderId, {
        method: dto.method,
        gateway_ref: dto.reference,
        recordedByUserId: actorUserId,
        onApplied: (m) =>
          this.audit.record(
            {
              action: AuditAction.UPDATE,
              entity_type: 'School',
              entity_id: order.school_id,
              tenant_id: order.school_id,
              performed_by_user_id: actorUserId,
              new_values: {
                event: 'OFFLINE_PAYMENT_RECORDED',
                order_id: orderId,
                method: dto.method,
                reference: dto.reference,
                idempotency_key: dto.idempotency_key,
              },
            },
            m,
          ),
      });
      return { applied, school_id: order.school_id };
    } catch (e) {
      // UQ (method, gateway_ref): one slip number on a second order. Rule 23: no echo.
      const err = (e as { driverError?: { code?: string; constraint?: string } }).driverError;
      if (err?.code === '23505' && err.constraint === 'UQ_platform_payments_method_gateway_ref') {
        throw new ConflictException({
          message: 'This payment reference is already used',
          details: { code: 'REFERENCE_IN_USE' },
        });
      }
      throw e;
    }
  }

  /** Throws 409 BKASH_PAYMENT_LIVE, or 503 when Redis cannot say (fail closed). */
  private async assertNoLiveBkash(orderId: string): Promise<void> {
    const live = await this.bkash.paymentMayBeLive(orderId).catch((err: unknown) => {
      this.logger.error(`offline payment: bKash state unreadable: ${String(err)}`);
      throw new ServiceUnavailableException('Try again in a few minutes.');
    });
    if (live) {
      throw new ConflictException({
        message: 'An online payment for this order may still complete',
        details: { code: 'BKASH_PAYMENT_LIVE' },
      });
    }
  }

  /** The SMS package twin of `recordOfflinePayment`: same guards, audit and replay answer. */
  async recordOfflineBundlePayment(orderId: string, dto: OfflinePaymentDto, actorUserId: string) {
    const bundles = this.moduleRef.get(SmsBundlePaymentService, { strict: false });
    const order = await bundles.findForPayment(orderId);
    if (!order) throw new NotFoundException('Order not found');
    const S = SmsBundleOrderStatus;
    // Already paid (any later state): a replay, nothing to do.
    if ([S.PAID, S.ACTIVE, S.USED_UP, S.EXPIRED].includes(order.status)) {
      return { applied: false, school_id: order.school_id };
    }
    if (order.status !== S.PENDING_PAYMENT) {
      throw new ConflictException({
        message: 'This order cannot be paid',
        details: { code: 'ORDER_NOT_PENDING' },
      });
    }
    await this.assertNoLiveBkash(orderId);
    // D8: a new package payment waits while sales are paused (markPaid itself never refuses).
    await bundles.assertSalesOpen();
    try {
      const { applied } = await bundles.markPaid(orderId, {
        method: dto.method,
        gateway_ref: dto.reference,
        recordedByUserId: actorUserId,
        onApplied: (m) =>
          this.audit.record(
            {
              action: AuditAction.UPDATE,
              entity_type: 'School',
              entity_id: order.school_id,
              tenant_id: order.school_id,
              performed_by_user_id: actorUserId,
              new_values: {
                event: 'OFFLINE_PAYMENT_RECORDED',
                bundle_order_id: orderId,
                method: dto.method,
                reference: dto.reference,
                idempotency_key: dto.idempotency_key,
              },
            },
            m,
          ),
      });
      return { applied, school_id: order.school_id };
    } catch (e) {
      const err = (e as { driverError?: { code?: string; constraint?: string } }).driverError;
      if (err?.code === '23505' && err.constraint === 'UQ_platform_payments_method_gateway_ref') {
        throw new ConflictException({
          message: 'This payment reference is already used',
          details: { code: 'REFERENCE_IN_USE' },
        });
      }
      throw e;
    }
  }

  /** GRANT order, idempotent per key. TrialModule imports BillingModule, so it is looked up lazily. */
  async grant(schoolId: string, dto: GrantSeatsDto, actorUserId: string) {
    const trial = this.moduleRef.get(TrialService, { strict: false });
    await trial.grantSeats(schoolId, dto, { userId: actorUserId });
    return this.schoolDetail(schoolId);
  }
}
