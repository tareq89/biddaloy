import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditAction, IDLE_REASON, SeatOrderStatus } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';
import { SchoolsService } from '../schools/schools.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import type { AdminNoticeKey } from '../schools/trial/admin-notice-templates';
import { getSeatUsage } from '../schools/trial/seat-limit.service';
import { DAY_MS } from '../schools/trial/trial.constants';
import {
  IDLE_DELETE_AFTER_DAYS,
  IDLE_SUSPEND_DAY,
  IDLE_SUSPEND_GAP_DAYS,
  IDLE_URGENT_DAY,
  IDLE_WARN_DAY,
  idleAgeDays,
  idleClock,
} from './idle-account.constants';

export interface IdleRunResult {
  notified: number;
  suspended: number;
  deleted: number;
  failed: number;
}

type SchoolOutcome = 'none' | 'notified' | 'suspended';

interface IdleRow {
  created_at: Date;
  status_changed_at: Date | null;
  status_reason: string | null;
  onboarding: Record<string, unknown> | null;
}

/**
 * Idle-account lifecycle (Epic 49 D5): a school with no seat gets `idle_d20`, then `idle_d27`,
 * is suspended (reason IDLE) at day 30, and is soft-deleted 30 days after that. Every run
 * re-checks the seat count, so adding a student cancels the whole thing with no flag to keep.
 */
@Injectable()
export class IdleAccountService {
  private readonly logger = new Logger(IdleAccountService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schools: SchoolsService,
    private readonly tenantStatus: TenantStatusService,
    private readonly audit: AuditService,
    private readonly notices: AdminNoticeService,
    private readonly sessionCutoff: SessionCutoffService,
  ) {}

  async runDaily(now: Date = new Date()): Promise<IdleRunResult> {
    const result: IdleRunResult = { notified: 0, suspended: 0, deleted: 0, failed: 0 };
    // `findAllActive` excludes only the configured platform id; outside production the
    // slug-discovered platform console must be skipped too.
    const platformId = await this.tenantStatus.platformTenantId();
    for (const { id } of await this.schools.findAllActive()) {
      if (id === platformId) continue;
      try {
        const outcome = await this.checkSchool(id, now);
        if (outcome === 'notified') result.notified++;
        if (outcome === 'suspended') result.suspended++;
      } catch (err) {
        // One school's failure must not stop the rest; tomorrow's run retries it.
        result.failed++;
        this.logger.error(
          `Idle check failed for school ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    try {
      result.deleted = await this.softDeleteDue(now);
    } catch (err) {
      result.failed++;
      this.logger.error(
        `Idle soft delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.logger.log(
      `Idle accounts done: ${result.notified} notified, ${result.suspended} suspended, ${result.deleted} deleted, ${result.failed} failed`,
    );
    return result;
  }

  private async checkSchool(id: string, now: Date): Promise<SchoolOutcome> {
    let notice: AdminNoticeKey | null = null;
    let suspendedUserIds: string[] | null = null;

    await this.dataSource.transaction(async (m) => {
      const [row]: IdleRow[] = await m.query(
        `SELECT created_at, status_changed_at, status_reason, onboarding
           FROM schools
          WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
            FOR NO KEY UPDATE`,
        [id],
      );
      if (!row) return;
      const clock = idleClock(
        new Date(row.created_at),
        row.status_changed_at ? new Date(row.status_changed_at) : null,
      );
      const age = idleAgeDays(clock, now);
      if (age < IDLE_WARN_DAY) return;
      // The cancel: any seat at all ends the lifecycle for this run.
      if ((await getSeatUsage(m, id)).used > 0) return;
      // A school that has paid for seats (any period) is a customer, not an abandoned signup.
      const paid = await m.query(
        `SELECT 1 FROM seat_orders WHERE school_id = $1 AND status = 'PAID' LIMIT 1`,
        [id],
      );
      if (paid.length > 0) return;

      const warnings = (row.onboarding?.idle_warnings ?? {}) as Record<string, string>;
      // A stamp older than the clock is from before a reactivation and does not count.
      const sentAt = (key: string): Date | null => {
        const at = warnings[key] ? new Date(warnings[key]) : null;
        return at && at >= clock ? at : null;
      };
      const d27 = sentAt('idle_d27');

      if (
        age >= IDLE_SUSPEND_DAY &&
        d27 &&
        // Half a day of slack: the notice goes out a few seconds after `now` of its own run, so
        // "3 days later" at the same wall-clock time would otherwise miss by seconds.
        now.getTime() - d27.getTime() >= IDLE_SUSPEND_GAP_DAYS * DAY_MS - DAY_MS / 2
      ) {
        // ponytail: with seat_limit NULL `lockSeatUsage` takes no lock, so a student added in this
        // same instant can land in a suspended school; revive fixes it. Upgrade path: make the
        // student-add paths lock unconditionally.
        await m.query(
          `UPDATE schools SET status = 'SUSPENDED', status_reason = $3, status_changed_at = $2
            WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
          [id, now, IDLE_REASON],
        );
        await this.audit.record(
          {
            action: AuditAction.SUSPEND,
            entity_type: 'School',
            entity_id: id,
            tenant_id: id,
            performed_by_user_id: null,
            old_values: { status: 'ACTIVE', reason: row.status_reason },
            new_values: { status: 'SUSPENDED', reason: IDLE_REASON, event: 'IDLE_SUSPENDED' },
          },
          m,
        );
        const members: { user_id: string }[] = await m.query(
          `SELECT DISTINCT user_id FROM user_tenants WHERE tenant_id = $1 AND deleted_at IS NULL`,
          [id],
        );
        suspendedUserIds = members.map((r) => r.user_id);
        return;
      }

      // Only the highest notice due goes out; a legacy 45-day-old school gets idle_d27 only.
      if (age >= IDLE_URGENT_DAY && !d27) notice = 'idle_d27';
      else if (age < IDLE_URGENT_DAY && !sentAt('idle_d20')) notice = 'idle_d20';
      if (!notice) return;

      // Mark inside the transaction, send after commit: at most once, never a duplicate on crash.
      const next = {
        ...row.onboarding,
        idle_warnings: { ...warnings, [notice]: now.toISOString() },
      };
      await m.query(`UPDATE schools SET onboarding = $2::jsonb WHERE id = $1`, [
        id,
        JSON.stringify(next),
      ]);
    });

    if (suspendedUserIds) {
      // After commit. The cache goes first so the suspension is live at once; one member's
      // failed cut-off is logged and must not skip the rest, the notice or the recheck.
      await this.tenantStatus.invalidate(id);
      const at = new Date(); // Rule 8: app clock
      for (const userId of suspendedUserIds as string[]) {
        try {
          await this.sessionCutoff.cutOff(userId, undefined, at);
        } catch (err) {
          this.logger.error(
            `Session cut-off failed for user ${userId} of school ${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      await this.notices.notifyAdmins(id, 'idle_suspended');
      emitRecheck(attentionEvents, { tenantId: id, ruleKey: 'account.idle' });
      return 'suspended';
    }
    if (notice) {
      await this.notices.notifyAdmins(id, notice);
      return 'notified';
    }
    return 'none';
  }

  /** Soft delete only: the row stays, `deleted_at` is set. Hard delete is a platform action (#1790). */
  private async softDeleteDue(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - IDLE_DELETE_AFTER_DAYS * DAY_MS);
    const ids = await this.dataSource.transaction(async (m) => {
      // The CTE makes the result plain rows: a bare UPDATE ... RETURNING comes back from TypeORM
      // as `[rows, count]` or as `[]` depending on the match count.
      const rows: { id: string }[] = await m.query(
        `WITH gone AS (
           UPDATE schools SET deleted_at = $1
            WHERE status = 'SUSPENDED' AND status_reason = $2 AND deleted_at IS NULL
              AND status_changed_at <= $3
              AND NOT EXISTS (SELECT 1 FROM seat_orders o
                               WHERE o.school_id = schools.id AND o.status = $4)
          RETURNING id)
         SELECT id FROM gone`,
        [now, IDLE_REASON, cutoff, SeatOrderStatus.PAID],
      );
      for (const { id } of rows) {
        await this.audit.record(
          {
            action: AuditAction.DELETE,
            entity_type: 'School',
            entity_id: id,
            tenant_id: id,
            performed_by_user_id: null,
            new_values: { event: 'IDLE_SOFT_DELETED' },
          },
          m,
        );
      }
      return rows.map((r) => r.id);
    });
    for (const id of ids) await this.tenantStatus.invalidate(id);
    return ids.length;
  }
}
