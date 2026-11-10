import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditAction, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { maskEmail, maskPhone } from '../../account-access/contact-mask.util';
import { MfaService } from '../../auth/mfa/mfa.service';
import { RefreshTokenService } from '../../auth/refresh-token.service';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import {
  PlatformHistoryPageDto,
  PlatformHistoryRowDto,
  PlatformOwnerDto,
} from './dto/platform-owners.dto';

const OWNER_NOT_FOUND = 'Owner not found.';

/** 409 with a stable `details.code` the UI can switch on (same shape as ApprovalRequiredException). */
function conflict(message: string, code: string): never {
  throw new HttpException({ message, details: { code } }, HttpStatus.CONFLICT);
}

/** Fixed text per action: the history never prints a snapshot, so it cannot leak a contact or code. */
const LABELS: Record<string, string> = {
  PLATFORM_LOGIN: 'Signed in',
  PLATFORM_LOGIN_FAILED: 'Failed sign-in',
  PLATFORM_OWNER_LOCKED: 'Owner locked',
  PLATFORM_OWNER_UNLOCKED: 'Owner unlocked',
  PLATFORM_MFA_ENROLLED: 'Authenticator set up',
  PLATFORM_RECOVERY_USED: 'Recovery code used',
  PLATFORM_APPROVAL_REQUESTED: 'Approval requested',
  PLATFORM_APPROVAL_GRANTED: 'Approval granted',
  PLATFORM_APPROVAL_DENIED: 'Approval denied',
  PLATFORM_OWNER_REPLACED: 'Owner replaced',
  PLATFORM_MFA_RESET: 'Authenticator reset',
  PLATFORM_PASSWORD_RESET: 'Password reset',
  PLATFORM_SETTINGS_CHANGED: 'Setting changed',
};

interface OwnerRow {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  locked_at: Date | null;
  locked_by_name: string | null;
  last_login_at: Date | null;
}

/** [Epic 98] Owner list, lock, unlock and platform history. There is no delete: D10, ever. */
@Injectable()
export class PlatformOwnersService {
  private readonly logger = new Logger(PlatformOwnersService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly mfa: MfaService,
    private readonly cutoff: SessionCutoffService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
    private readonly delivery: AccountAccessDeliveryService,
  ) {}

  async list(): Promise<PlatformOwnerDto[]> {
    const rows: OwnerRow[] = await this.ds.query(
      `SELECT pa.user_id, u.full_name, u.email, u.phone, u.status, pa.locked_at,
              lb.full_name AS locked_by_name,
              (SELECT max(a.created_at) FROM audit_logs a
                WHERE a.tenant_id IS NULL AND a.action = 'PLATFORM_LOGIN'
                  AND a.performed_by_user_id = pa.user_id) AS last_login_at
         FROM platform_admins pa
         JOIN users u ON u.id = pa.user_id
         LEFT JOIN users lb ON lb.id = pa.locked_by
        ORDER BY pa.created_at ASC, pa.user_id ASC`,
    );
    return Promise.all(
      rows.map(async (r) => ({
        userId: r.user_id,
        fullName: r.full_name,
        email: r.email ? maskEmail(r.email) : null,
        phone: r.phone ? maskPhone(r.phone) : null,
        status: r.status === UserStatus.ACTIVE ? ('ACTIVE' as const) : ('LOCKED' as const),
        lockedAt: r.locked_at ? new Date(r.locked_at).toISOString() : null,
        lockedByName: r.locked_by_name,
        lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
        mfaEnrolled: (await this.mfa.status(r.user_id)).enrolled,
      })),
    );
  }

  /** Locks another owner and ends all their sessions. Always leaves at least one other active owner. */
  async lock(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId) conflict('You cannot lock yourself.', 'CANNOT_LOCK_SELF');
    await this.ds.transaction(async (em) => {
      // Serialises two owners locking each other at once: the second waits, then sees one left.
      await em.query(`SELECT 1 FROM platform_admins ORDER BY user_id FOR UPDATE`);
      // Read statuses only AFTER the lock: under READ COMMITTED a waiter's first snapshot is stale,
      // this second query sees the other lock's committed result.
      const admins: { user_id: string; status: string }[] = await em.query(
        `SELECT pa.user_id, u.status FROM platform_admins pa
           JOIN users u ON u.id = pa.user_id ORDER BY pa.user_id`,
      );
      const target = admins.find((a) => a.user_id === targetId);
      if (!target) throw new NotFoundException(OWNER_NOT_FOUND);
      if (target.status !== UserStatus.ACTIVE)
        conflict('Owner is already locked.', 'ALREADY_LOCKED');
      const othersActive = admins.filter(
        (a) => a.user_id !== targetId && a.status === UserStatus.ACTIVE,
      );
      if (othersActive.length === 0) conflict('This is the last active owner.', 'LAST_OWNER');

      await em.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [targetId]);
      await em.query(
        `UPDATE platform_admins SET locked_by = $2, locked_at = now() WHERE user_id = $1`,
        [targetId, actorId],
      );
      await this.cutoff.cutOff(targetId, em); // Rule 8
      await this.refreshTokens.revokeAllForUser(targetId, em);
      // Idle/absolute Redis keys need no drop: a SUSPENDED owner is refused by the cockpit JWT
      // strategy on the next request, and CockpitSessionService.endAll stays quiet on them too.
    });
    await this.record(AuditAction.PLATFORM_OWNER_LOCKED, actorId, targetId);
    await this.notify('PLATFORM_OWNER_LOCKED', actorId, targetId, 'locked');
  }

  async unlock(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId) conflict('You cannot unlock yourself.', 'CANNOT_UNLOCK_SELF');
    await this.ds.transaction(async (em) => {
      const res = await em.query(
        `UPDATE users SET status = 'ACTIVE'
          WHERE id = $1 AND status = 'SUSPENDED'
            AND EXISTS (SELECT 1 FROM platform_admins WHERE user_id = $1)
          RETURNING id`,
        [targetId],
      );
      const updated = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
      if (updated.length === 0) {
        const isOwner = await em.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [
          targetId,
        ]);
        if (isOwner.length === 0) throw new NotFoundException(OWNER_NOT_FOUND);
        conflict('Owner is not locked.', 'NOT_LOCKED');
      }
      await em.query(
        `UPDATE platform_admins SET locked_by = NULL, locked_at = NULL WHERE user_id = $1`,
        [targetId],
      );
    });
    await this.record(AuditAction.PLATFORM_OWNER_UNLOCKED, actorId, targetId);
    await this.notify('PLATFORM_OWNER_UNLOCKED', actorId, targetId, 'unlocked');
  }

  private async record(action: AuditAction, actorId: string, targetId: string): Promise<void> {
    await this.audit.record({
      action,
      entity_type: 'PlatformAdmin',
      entity_id: targetId,
      tenant_id: null,
      performed_by_user_id: actorId,
      new_values: { target_user_id: targetId },
    });
  }

  /** SMS + email to the owner acted on and to the actor. Never blocks the change. */
  private async notify(
    kind: 'PLATFORM_OWNER_LOCKED' | 'PLATFORM_OWNER_UNLOCKED',
    actorId: string,
    targetId: string,
    verb: string,
  ): Promise<void> {
    const users: { id: string; full_name: string; email: string | null; phone: string | null }[] =
      await this.ds.query(`SELECT id, full_name, email, phone FROM users WHERE id = ANY($1)`, [
        [actorId, targetId],
      ]);
    const name = (id: string) => users.find((u) => u.id === id)?.full_name ?? 'an owner';
    const detail = `${name(targetId)} was ${verb} by ${name(actorId)}.`;
    for (const u of users) {
      for (const [medium, to] of [
        [CommunicationMedium.SMS, u.phone],
        [CommunicationMedium.EMAIL, u.email],
      ] as const) {
        if (!to) continue;
        await this.delivery
          .deliver({
            tenantId: null,
            medium,
            to,
            recipientName: u.full_name,
            kind,
            vars: { detail },
          })
          .catch(() => this.logger.warn(`${kind} notice not delivered`));
      }
    }
  }

  /** Newest first, keyset cursor on (created_at, id). Fixed labels only. */
  async history(cursor?: string, limit = 50): Promise<PlatformHistoryPageDto> {
    const take = Math.min(Math.max(limit, 1), 100);
    let after: { ts: string; id: string } | null = null;
    if (cursor) {
      const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
      if (!ts || !id || Number.isNaN(Date.parse(ts)) || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new HttpException('Cursor is not valid.', HttpStatus.BAD_REQUEST);
      }
      after = { ts, id };
    }
    const rows: { id: string; action: string; actor_name: string | null; at: Date; ts: string }[] =
      await this.ds.query(
        `SELECT a.id, a.action::text AS action, u.full_name AS actor_name, a.created_at AS at,
                a.created_at::text AS ts
           FROM audit_logs a LEFT JOIN users u ON u.id = a.performed_by_user_id
          WHERE a.tenant_id IS NULL AND a.action::text LIKE 'PLATFORM\\_%'
            AND ($1::timestamptz IS NULL OR (a.created_at, a.id) < ($1::timestamptz, $2::uuid))
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $3`,
        [after?.ts ?? null, after?.id ?? null, take + 1],
      );
    const page = rows.slice(0, take);
    const data: PlatformHistoryRowDto[] = page.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: r.actor_name,
      at: new Date(r.at).toISOString(),
      label: LABELS[r.action] ?? 'Platform event',
    }));
    const last = page[page.length - 1];
    return {
      data,
      nextCursor:
        rows.length > take && last
          ? Buffer.from(`${last.ts}|${last.id}`, 'utf8').toString('base64url')
          : null,
    };
  }
}
