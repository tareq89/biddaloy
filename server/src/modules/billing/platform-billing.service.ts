import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  IDLE_REASON,
  SeatOrderStatus,
  type PlatformSchoolBilling,
  type PlatformSchoolBillingPage,
  type PlatformSchoolBillingDetail,
  type SchoolBillingFilter,
} from '@biddaloy/shared';
import { SCHOOL_TZ, localDate } from '../../common/time';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { AuditService } from '../audit/audit.service';
import { TrialService } from '../schools/trial/trial.service';
import { OrdersService } from './orders.service';
import type { GrantSeatsDto, OfflinePaymentDto } from './dto/platform-billing.dto';

/** "Expiring" window of the platform list. */
export const EXPIRING_WITHIN_DAYS = 14;

/**
 * One row per school; entitled / used / paid-until are correlated subqueries. Static text on
 * purpose (Rule 4): every value is a bind parameter, the optional filters are `$n IS NULL OR ...`.
 * $1 PAID, $2 today, $3 ACTIVE student, $4 PENDING, $5 name pattern, $6 filter, $7 IDLE reason,
 * $8 expiring-until date, $9 school id, $10 limit, $11 offset.
 * "Exhausted" = every seat used, by the limit (a blocked limit of 0 counts) or by the paid seats.
 */
const SCHOOLS_SQL = `
SELECT t.*, count(*) OVER()::int AS total FROM (
  SELECT s.id, s.name, s.status, s.status_reason, (s.deleted_at IS NOT NULL) AS deleted, s.seat_limit,
    COALESCE((SELECT SUM(o.seats) FROM seat_orders o WHERE o.school_id = s.id AND o.status = $1
               AND o.period_start <= $2::date AND o.period_end > $2::date), 0)::int AS seats_entitled,
    (SELECT count(*) FROM students st WHERE st.tenant_id = s.id AND st.deleted_at IS NULL
       AND st.enrollment_status = $3)::int AS seats_used,
    (SELECT (max(o.period_end) - 1)::text FROM seat_orders o
      WHERE o.school_id = s.id AND o.status = $1) AS paid_until,
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

type SchoolRow = PlatformSchoolBilling & { seat_limit: number | null; total: number };

@Injectable()
export class PlatformBillingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
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

  async schoolDetail(schoolId: string, now = new Date()): Promise<PlatformSchoolBillingDetail> {
    const [row] = await this.query(now, { id: schoolId, limit: 1, offset: 0 });
    if (!row) throw new NotFoundException('School not found');
    const { total: _t, seat_limit: _s, ...school } = row;
    return { ...school, orders: await this.orders.list(schoolId, 100) };
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

  /** GRANT order, idempotent per key. TrialModule imports BillingModule, so it is looked up lazily. */
  async grant(schoolId: string, dto: GrantSeatsDto, actorUserId: string) {
    const trial = this.moduleRef.get(TrialService, { strict: false });
    await trial.grantSeats(schoolId, dto, { userId: actorUserId });
    return this.schoolDetail(schoolId);
  }
}
