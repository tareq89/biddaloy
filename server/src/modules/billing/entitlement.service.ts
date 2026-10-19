import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditAction, SeatOrderStatus } from '@biddaloy/shared';
import { billingFreeUntil } from '../../config/env.validation';
import { SCHOOL_TZ, localDate } from '../../common/time';
import { AuditService } from '../audit/audit.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';

/**
 * Keeps `schools.seat_limit` equal to the school's paid entitlement (Epic 49 D2-D4).
 * Before `BILLING_FREE_UNTIL` the limit is NULL (unlimited); after it, the sum of PAID
 * orders whose [period_start, period_end) covers today in school time (0 when none).
 */
@Injectable()
export class EntitlementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  /** `null` = unlimited (free period). */
  async limitFor(
    manager: EntityManager,
    schoolId: string,
    at: Date = new Date(),
  ): Promise<number | null> {
    if (at.getTime() < billingFreeUntil().getTime()) return null;
    return this.paidSeats(manager, schoolId, at);
  }

  /** Seats bought and in force on `at`, free period or not. */
  async paidSeats(
    manager: EntityManager,
    schoolId: string,
    at: Date = new Date(),
  ): Promise<number> {
    const [row]: { n: number }[] = await manager.query(
      `SELECT COALESCE(SUM(seats), 0)::int AS n FROM seat_orders
        WHERE school_id = $1 AND status = $2 AND period_start <= $3::date AND period_end > $3::date`,
      [schoolId, SeatOrderStatus.PAID, localDate(at, SCHOOL_TZ)],
    );
    return row.n;
  }

  /**
   * Writes `schools.seat_limit` on the caller's transaction (audited only when it changed).
   * The caller calls `afterCommit` once its transaction has committed.
   */
  async recompute(
    schoolId: string,
    manager: EntityManager,
    at: Date = new Date(),
  ): Promise<{ changed: boolean; limit: number | null }> {
    // Same lock as every student add (FOR NO KEY UPDATE, see seat-limit.service).
    const [school]: { seat_limit: number | null }[] = await manager.query(
      'SELECT seat_limit FROM schools WHERE id = $1 FOR NO KEY UPDATE',
      [schoolId],
    );
    if (!school) return { changed: false, limit: null };
    const limit = await this.limitFor(manager, schoolId, at);
    if (school.seat_limit === limit) return { changed: false, limit };
    await manager.query('UPDATE schools SET seat_limit = $2 WHERE id = $1', [schoolId, limit]);
    await this.audit.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'School',
        entity_id: schoolId,
        tenant_id: schoolId,
        performed_by_user_id: null,
        old_values: { seat_limit: school.seat_limit },
        new_values: { event: 'SEAT_LIMIT_RECOMPUTED', seat_limit: limit },
      },
      manager,
    );
    return { changed: true, limit };
  }

  /** Own transaction + post-commit side effects; used by the daily job. Returns whether it changed. */
  async recomputeAndNotify(schoolId: string, at: Date = new Date()): Promise<boolean> {
    const res = await this.dataSource.transaction((m) => this.recompute(schoolId, m, at));
    if (res.changed) await this.afterCommit(schoolId);
    return res.changed;
  }

  /** Call after the transaction that ran `recompute` committed. */
  async afterCommit(schoolId: string): Promise<void> {
    await this.tenantStatus.invalidate(schoolId);
    // seats.expiring replaces billing.renewal_due (Epic 49); seats.exhausted follows the limit too.
    emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey: 'seats.expiring' });
    emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey: 'seats.exhausted' });
  }
}
