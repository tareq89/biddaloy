import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditAction, IDLE_REASON, SchoolStatus, SeatOrderStatus } from '@biddaloy/shared';
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
   * Writes `schools.seat_limit` on the caller's transaction (audited only when it changed), and
   * lifts an IDLE suspension once the school has a PAID order (a school that pays is not idle).
   * The caller calls `afterCommit` once its transaction has committed.
   */
  async recompute(
    schoolId: string,
    manager: EntityManager,
    at: Date = new Date(),
  ): Promise<{ changed: boolean; limit: number | null }> {
    // Same lock as every student add (FOR NO KEY UPDATE, see seat-limit.service).
    const [school]: { seat_limit: number | null; status: string; status_reason: string | null }[] =
      await manager.query(
        'SELECT seat_limit, status, status_reason FROM schools WHERE id = $1 FOR NO KEY UPDATE',
        [schoolId],
      );
    if (!school) return { changed: false, limit: null };
    const limit = await this.limitFor(manager, schoolId, at);
    let changed = false;
    if (school.seat_limit !== limit) {
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
      changed = true;
    }
    // Paying lifts an idle suspension at once, the same as a platform grant does.
    if (
      school.status === SchoolStatus.SUSPENDED &&
      school.status_reason === IDLE_REASON &&
      (await this.hasPaidOrder(manager, schoolId))
    ) {
      await manager.query(
        'UPDATE schools SET status = $3, status_reason = NULL, status_changed_at = $2 WHERE id = $1',
        [schoolId, at, SchoolStatus.ACTIVE],
      );
      await this.audit.record(
        {
          action: AuditAction.REACTIVATE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: null,
          old_values: { status: SchoolStatus.SUSPENDED, reason: IDLE_REASON },
          new_values: { status: SchoolStatus.ACTIVE, event: 'IDLE_REACTIVATED' },
        },
        manager,
      );
      changed = true;
    }
    return { changed, limit };
  }

  private async hasPaidOrder(manager: EntityManager, schoolId: string): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      'SELECT 1 FROM seat_orders WHERE school_id = $1 AND status = $2 LIMIT 1',
      [schoolId, SeatOrderStatus.PAID],
    );
    return rows.length > 0;
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
    // ponytail: no seats.* attention rule exists yet (decision: seats.expiring replaces
    // billing.renewal_due); the engine drops a recheck for a rule it does not know.
    emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey: 'seats.expiring' });
  }
}
