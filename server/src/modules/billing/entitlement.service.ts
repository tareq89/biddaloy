import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  IDLE_REASON,
  SchoolStatus,
  SEATS_EXPIRED_REASON,
  SeatOrderStatus,
} from '@biddaloy/shared';
import { billingFreeUntil } from '../../config/env.validation';
import { SCHOOL_TZ, localDate } from '../../common/time';
import { AuditService } from '../audit/audit.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';
import { readOnlyUntilFor } from './seat-grace';

/**
 * Keeps `schools.seat_limit` equal to the school's paid entitlement (Epic 49 D2-D4).
 * Before `BILLING_FREE_UNTIL` the limit is NULL (unlimited); after it, the sum of PAID
 * orders whose [period_start, period_end) covers today in school time (0 when none).
 * Also owns the seat-grace end (D9): suspend 7 days after the paid period ended, reactivate on payment.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly tenantStatus: TenantStatusService,
    private readonly sessionCutoff: SessionCutoffService,
    private readonly notices: AdminNoticeService,
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
   * reactivates a SUSPENDED / SEATS_EXPIRED school once it is no longer over its seats (D9) —
   * also when the limit value itself did not change — and lifts an IDLE suspension once the
   * school has a PAID order (a school that pays is not idle).
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
    // Paying lifts a seats suspension (D9) or an idle one (like a platform grant) at once.
    const lift =
      school.status === SchoolStatus.SUSPENDED &&
      ((school.status_reason === SEATS_EXPIRED_REASON &&
        (await this.isWithinLimit(manager, schoolId, limit))) ||
        (school.status_reason === IDLE_REASON && (await this.hasPaidOrder(manager, schoolId))));
    if (lift) {
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
          old_values: { status: SchoolStatus.SUSPENDED, reason: school.status_reason },
          new_values: {
            status: SchoolStatus.ACTIVE,
            event: school.status_reason === IDLE_REASON ? 'IDLE_REACTIVATED' : 'SEATS_REACTIVATED',
          },
        },
        manager,
      );
      changed = true;
    }
    return { changed, limit };
  }

  /** Same count as `seat-limit.service`: ACTIVE students, not soft-deleted. */
  private async isWithinLimit(
    manager: EntityManager,
    schoolId: string,
    limit: number | null,
  ): Promise<boolean> {
    if (limit === null) return true;
    const [row]: { n: number }[] = await manager.query(
      `SELECT count(*)::int AS n FROM students
        WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = $2`,
      [schoolId, EnrollmentStatus.ACTIVE],
    );
    return row.n <= limit;
  }

  /**
   * Daily job step (D9): suspends an ACTIVE school that is still over its seats once its 7-day
   * read-only window has ended. Safe for any school id: not over, unlimited, not ACTIVE or the
   * platform tenant all return false. Returns whether it suspended.
   */
  async suspendIfGraceOver(schoolId: string, now: Date = new Date()): Promise<boolean> {
    if (schoolId === (await this.tenantStatus.platformTenantId())) return false;
    const memberIds = await this.dataSource.transaction(async (m) => {
      const [school]: { status: string }[] = await m.query(
        'SELECT status FROM schools WHERE id = $1 AND deleted_at IS NULL FOR NO KEY UPDATE',
        [schoolId],
      );
      if (school?.status !== SchoolStatus.ACTIVE) return null;
      const until = await readOnlyUntilFor(m, schoolId, now);
      if (!until || until.getTime() > now.getTime()) return null;
      await m.query(
        'UPDATE schools SET status = $3, status_reason = $4, status_changed_at = $2 WHERE id = $1',
        [schoolId, now, SchoolStatus.SUSPENDED, SEATS_EXPIRED_REASON],
      );
      await this.audit.record(
        {
          action: AuditAction.SUSPEND,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: null,
          old_values: { status: SchoolStatus.ACTIVE },
          new_values: {
            status: SchoolStatus.SUSPENDED,
            reason: SEATS_EXPIRED_REASON,
            event: 'SEATS_SUSPENDED',
          },
        },
        m,
      );
      const members: { user_id: string }[] = await m.query(
        'SELECT DISTINCT user_id FROM user_tenants WHERE tenant_id = $1 AND deleted_at IS NULL',
        [schoolId],
      );
      return members.map((r) => r.user_id);
    });
    if (!memberIds) return false;

    // After commit (Rule 8): cache first so the suspension is live at once, then cut sessions off.
    await this.tenantStatus.invalidate(schoolId);
    const at = new Date(); // app clock, not DB clock
    for (const userId of memberIds) {
      try {
        await this.sessionCutoff.cutOff(userId, undefined, at);
      } catch (err) {
        // One member's failure must not skip the rest or the notice.
        this.logger.error(
          `Session cut-off failed for user ${userId} of school ${schoolId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    try {
      await this.notices.notifyAdmins(schoolId, 'seats_suspended');
    } catch (err) {
      this.logger.error(
        `Suspension notice failed for school ${schoolId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // The limit did not change but the school did: let the engine recheck the seat rules.
    emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey: 'seats.expiring' });
    emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey: 'seats.exhausted' });
    return true;
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
    // seats.expiring replaces billing.renewal_due (Epic 49); seats.exhausted follows the limit too.
    emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey: 'seats.expiring' });
    emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey: 'seats.exhausted' });
  }
}
