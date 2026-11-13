import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditAction, UserRole } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { isDemoMode } from '../demo/demo-mode';
import { TenantStatusService } from '../schools/tenant-status.service';

export const CUTOVER_DONE_KEY = 'cutover.done';
/** User ids whose sessions still need cutting off after the conversion committed. */
export const CUTOVER_PENDING_KEY = 'cutover.pending_cutoff';
/** Arbitrary constant: two app containers booting together queue on it. */
export const CUTOVER_LOCK_KEY = 98_001_002;

interface Membership {
  id: string;
  user_id: string;
  tenant_id: string;
  role: UserRole;
}

export interface CutoverCounts {
  removed: number;
  downgraded: number;
  duplicatesRemoved: number;
}

/** One planned (dry run) or made change. Ids only: never an email or phone (Rule 13). */
export interface CutoverPlanRow {
  userId: string;
  tenantId: string;
  action:
    | 'REMOVE_MEMBERSHIP'
    | 'DOWNGRADE_TO_ADMIN'
    | 'REMOVE_DUPLICATE_SUPER_ADMIN'
    /** A soft-deleted ADMIN row of the same user and school is switched back on. */
    | 'RESTORE_ADMIN';
}

export type CutoverStatus = 'done' | 'already_done' | 'dry_run';

export interface CutoverResult {
  status: CutoverStatus;
  counts: CutoverCounts;
  plan: CutoverPlanRow[];
  /** Users whose sessions are cut off by this run (including a resumed earlier run). */
  sessionsCut: number;
}

/** The cutover will not start: a precondition is missing. The message is fixed text (Rule 23). */
export class CutoverRefusedError extends Error {}

const ZERO: CutoverCounts = { removed: 0, downgraded: 0, duplicatesRemoved: 0 };

/** Thrown inside the dry-run transaction to roll it back; carries what the run would have done. */
class DryRunRollback extends Error {
  constructor(readonly outcome: { counts: CutoverCounts; plan: CutoverPlanRow[]; ids: string[] }) {
    super('dry run');
  }
}

/**
 * [Epic 98 / D18, D23] One-time conversion of the old platform authority: nobody keeps platform
 * power through a school membership. NOT run on boot: an operator starts it with
 * `server/dist/scripts/platform-cutover.js` after the #3773 sign-off (28-platform-runbook.md).
 * Idempotent (`cutover.done`), one transaction under an advisory lock, `--dry-run` rolls the same
 * transaction back. Logs counts only, never emails (Rule 13). Never deletes a user or a school.
 */
@Injectable()
export class PlatformCutoverService {
  private readonly logger = new Logger(PlatformCutoverService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tenantStatus: TenantStatusService,
    private readonly cutoff: SessionCutoffService,
    private readonly audit: AuditService,
  ) {}

  async run(opts: { dryRun?: boolean } = {}): Promise<CutoverResult> {
    if (isDemoMode()) throw new CutoverRefusedError('the demo has no cockpit and no cutover');
    if (await this.isDone(this.ds.manager)) {
      return { status: 'already_done', counts: ZERO, plan: [], sessionsCut: 0 };
    }
    // Without a working owner, removing the old authority would leave nobody in charge.
    if (!(await this.hasVerifiedOwner(this.ds.manager))) {
      throw new CutoverRefusedError(
        'no active, unlocked cockpit owner with a confirmed authenticator exists',
      );
    }
    // D18/D3b: "the platform school" is BOTH the legacy platform tenant and the `is_platform` home
    // row. Owners and SUPER_ADMINs lose membership on either. If neither resolves we cannot tell
    // platform rows from ordinary ones, so refuse.
    const platformIds = await this.tenantStatus.platformSchoolIds();
    if (platformIds.length === 0) {
      throw new CutoverRefusedError('no platform school could be resolved');
    }

    if (opts.dryRun) {
      try {
        await this.ds.transaction(async (em) => {
          await em.query(`SELECT pg_advisory_xact_lock($1)`, [CUTOVER_LOCK_KEY]);
          const c = await this.convert(em, platformIds);
          const ids = [...new Set([...(await this.pending(em)), ...c.affected])];
          throw new DryRunRollback({ counts: c.counts, plan: c.plan, ids });
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        const { counts, plan, ids } = error.outcome;
        return { status: 'dry_run', counts, plan, sessionsCut: ids.length };
      }
    }

    // Conversion + the affected user ids commit together; `cutover.done` is written only after the
    // post-commit session cutoff, so a crash in between is resumed by the next run (Rule 8).
    const { counts, plan, pending, skipped } = await this.ds.transaction(async (em) => {
      await em.query(`SELECT pg_advisory_xact_lock($1)`, [CUTOVER_LOCK_KEY]);
      if (await this.isDone(em)) {
        return {
          counts: ZERO,
          plan: [] as CutoverPlanRow[],
          pending: [] as string[],
          skipped: true as boolean,
        };
      }
      const c = await this.convert(em, platformIds);
      const ids = new Set([...(await this.pending(em)), ...c.affected]);
      if (ids.size === 0) await this.setKey(em, CUTOVER_DONE_KEY, true);
      else await this.setKey(em, CUTOVER_PENDING_KEY, [...ids]);
      return { counts: c.counts, plan: c.plan, pending: [...ids], skipped: false as boolean };
    });
    // Another operator finished while this one waited on the lock.
    if (skipped) return { status: 'already_done', counts: ZERO, plan: [], sessionsCut: 0 };
    await this.finishCutoff(pending);
    this.logger.log(
      `Platform cutover done: ${counts.removed} memberships removed, ` +
        `${counts.downgraded} SUPER_ADMIN downgraded to ADMIN, ` +
        `${counts.duplicatesRemoved} duplicate ADMIN rows removed`,
    );
    return { status: 'done', counts, plan, sessionsCut: pending.length };
  }

  /**
   * An owner who can really sign in to the cockpit: active, unlocked, confirmed authenticator, and
   * the password, phone and email the sign-in needs (login checks the password; a new device needs an
   * SMS and an email code).
   */
  private async hasVerifiedOwner(em: EntityManager): Promise<boolean> {
    const rows: unknown[] = await em.query(
      `SELECT 1 FROM platform_admins pa
         JOIN users u ON u.id = pa.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
              AND u.password_hash IS NOT NULL AND u.phone IS NOT NULL AND u.email IS NOT NULL
         JOIN user_mfa m ON m.user_id = pa.user_id AND m.confirmed_at IS NOT NULL
        WHERE pa.locked_at IS NULL
        LIMIT 1`,
    );
    return rows.length > 0;
  }

  /** Takes the cutoff time AFTER the commit, so a token issued off the old memberships is refused. */
  private async finishCutoff(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const at = new Date();
    for (const userId of ids) await this.cutoff.cutOff(userId, undefined, at);
    await this.ds.transaction(async (em) => {
      await em.query(`DELETE FROM platform_settings WHERE key = $1`, [CUTOVER_PENDING_KEY]);
      await this.setKey(em, CUTOVER_DONE_KEY, true);
    });
  }

  private async pending(em: EntityManager): Promise<string[]> {
    const rows: { value: string[] }[] = await em.query(
      `SELECT value FROM platform_settings WHERE key = $1`,
      [CUTOVER_PENDING_KEY],
    );
    return rows[0]?.value ?? [];
  }

  private setKey(em: EntityManager, key: string, value: unknown): Promise<unknown> {
    return em.query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
      [key, JSON.stringify(value)],
    );
  }

  private async isDone(em: EntityManager): Promise<boolean> {
    const rows: unknown[] = await em.query(
      `SELECT 1 FROM platform_settings WHERE key = $1 AND value = 'true'::jsonb`,
      [CUTOVER_DONE_KEY],
    );
    return rows.length > 0;
  }

  private async convert(
    em: EntityManager,
    platformIds: string[],
  ): Promise<{ counts: CutoverCounts; affected: string[]; plan: CutoverPlanRow[] }> {
    const counts: CutoverCounts = { removed: 0, downgraded: 0, duplicatesRemoved: 0 };
    const affected = new Set<string>();
    const plan: CutoverPlanRow[] = [];

    {
      // Owners lose any membership on a platform school (D2); so does every SUPER_ADMIN.
      const rows: Membership[] = await em.query(
        `SELECT id, user_id, tenant_id, role FROM user_tenants
          WHERE tenant_id = ANY($1::uuid[]) AND deleted_at IS NULL
            AND (role = $2 OR user_id IN (SELECT user_id FROM platform_admins))`,
        [platformIds, UserRole.SUPER_ADMIN],
      );
      for (const m of rows) {
        await this.softDelete(em, m);
        affected.add(m.user_id);
        plan.push({ userId: m.user_id, tenantId: m.tenant_id, action: 'REMOVE_MEMBERSHIP' });
        counts.removed++;
      }
    }

    const legacy: Membership[] = await em.query(
      `SELECT id, user_id, tenant_id, role FROM user_tenants
        WHERE role = $1 AND deleted_at IS NULL AND NOT (tenant_id = ANY($2::uuid[]))`,
      [UserRole.SUPER_ADMIN, platformIds],
    );
    for (const m of legacy) {
      // The unique key spans soft-deleted rows too, so look for any ADMIN row.
      const [admin]: { id: string; deleted_at: Date | null }[] = await em.query(
        `SELECT id, deleted_at FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = $3`,
        [m.user_id, m.tenant_id, UserRole.ADMIN],
      );
      if (admin) {
        await this.softDelete(em, m);
        plan.push({
          userId: m.user_id,
          tenantId: m.tenant_id,
          action: 'REMOVE_DUPLICATE_SUPER_ADMIN',
        });
        counts.duplicatesRemoved++;
        if (admin.deleted_at) {
          plan.push({ userId: m.user_id, tenantId: m.tenant_id, action: 'RESTORE_ADMIN' });
          await em.query(`UPDATE user_tenants SET deleted_at = NULL WHERE id = $1`, [admin.id]);
          await this.record(
            em,
            { ...m, id: admin.id, role: UserRole.ADMIN },
            { restored: true, role: UserRole.ADMIN },
            AuditAction.UPDATE,
          );
        }
      } else {
        await em.query(`UPDATE user_tenants SET role = $2 WHERE id = $1`, [m.id, UserRole.ADMIN]);
        await this.record(em, m, { role: UserRole.ADMIN }, AuditAction.UPDATE);
        plan.push({ userId: m.user_id, tenantId: m.tenant_id, action: 'DOWNGRADE_TO_ADMIN' });
        counts.downgraded++;
      }
      affected.add(m.user_id);
    }

    return { counts, affected: [...affected], plan };
  }

  private async softDelete(em: EntityManager, m: Membership): Promise<void> {
    await em.query(`UPDATE user_tenants SET deleted_at = now() WHERE id = $1`, [m.id]);
    await this.record(em, m, null, AuditAction.DELETE);
  }

  private record(
    em: EntityManager,
    m: Membership,
    next: Record<string, unknown> | null,
    action: AuditAction,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        // ponytail: 'UserTenant' is not in the shared audit catalogue (shared/ is another lane's);
        // the row is recorded against the user, with the membership id in the snapshot.
        entity_type: 'User',
        entity_id: m.user_id,
        tenant_id: m.tenant_id,
        performed_by_user_id: null,
        old_values: { table: 'user_tenants', membership_id: m.id, role: m.role },
        new_values: next,
      },
      em,
    );
  }
}
