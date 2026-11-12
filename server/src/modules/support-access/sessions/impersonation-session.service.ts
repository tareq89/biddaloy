import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type Redis from 'ioredis';
import {
  AuditAction,
  ImpersonationEndedBy,
  ImpersonationEntryKind,
  ImpersonationStatus,
  SupportAccessMode,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import type { ImpersonationLiveSession, ImpersonationSessionDto } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import { IMPERSONATION_REDIS, impKey, rateKey } from './impersonation-redis';

/** D6: the hard cap of one session. */
export const IMPERSONATION_MAX_MINUTES = 60;
/** D16: starts per platform admin per hour. */
export const IMPERSONATION_RATE_LIMIT = 10;
/** D23: live sessions one platform admin may hold at once. */
export const IMPERSONATION_MAX_LIVE = 3;
const RATE_WINDOW_SEC = 3600;
const LIST_LIMIT_MAX = 100;
const OPEN_STATUSES = "'ACTIVE','REQUESTED','APPROVED'";
const RETURNING = 'RETURNING id, tenant_id, platform_admin_id, target_user_id, role';
// Same sentence as @FailClosedWithoutRedis (Rule 15).
const REDIS_DOWN = 'This action is temporarily unavailable. Please try again in a few minutes.';
// One sentence for every "this person cannot be signed in as" reason (Rule 23: no oracle, no echo).
const PERSON_REFUSED = 'This person cannot be signed in as.';

export interface CreateImpersonationInput {
  platformAdminId: string;
  schoolId: string;
  targetUserId: string;
  role: UserRole;
  reason: string;
  viewOnly: boolean;
  entryKind: ImpersonationEntryKind;
}

interface EndedRow {
  id: string;
  tenant_id: string;
  platform_admin_id: string;
  target_user_id: string;
  role: string;
}

const fail = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ statusCode: status, message, code }, status);

/** D31: an ACTIVE row past its `expires_at` shows as EXPIRED before any sweep has flipped it. */
export function shownStatus(
  row: Pick<ImpersonationSession, 'status' | 'expires_at'>,
  now: Date = new Date(),
): ImpersonationStatus {
  if (row.status === 'ACTIVE' && row.expires_at && row.expires_at <= now) {
    return ImpersonationStatus.EXPIRED;
  }
  return row.status as ImpersonationStatus;
}

const liveJson = (row: ImpersonationSession): string =>
  JSON.stringify({
    adminId: row.platform_admin_id,
    userId: row.target_user_id,
    schoolId: row.tenant_id,
    role: row.role as UserRole,
    viewOnly: row.view_only,
    writeLocked: row.write_locked,
    kind: row.entry_kind as ImpersonationEntryKind,
  } satisfies ImpersonationLiveSession);

/**
 * [99.2.01] The life of a Login as session: create, activate, end, revoke, list, the live Redis
 * key (`imp:<sid>`), the start rate limit and the per-owner limits. A Redis error is a 503 (fail
 * closed, like RegistrationStagingService): a session that cannot be written to or removed from
 * Redis is neither created nor reported as ended, and the whole database transaction rolls back.
 */
@Injectable()
export class ImpersonationSessionService {
  private readonly logger = new Logger(ImpersonationSessionService.name);

  constructor(
    @InjectRepository(ImpersonationSession)
    private readonly repo: Repository<ImpersonationSession>,
    @Inject(IMPERSONATION_REDIS) private readonly redis: Redis,
    private readonly settings: SchoolSettingsReader,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateImpersonationInput): Promise<ImpersonationSession> {
    await this.takeRateToken(input.platformAdminId);
    const mode = (await this.settings.supportAccessFresh(input.schoolId)).mode;
    const emergency = input.entryKind === ImpersonationEntryKind.EMERGENCY;
    if (mode === SupportAccessMode.BLOCKED && !emergency) {
      throw fail(
        HttpStatus.FORBIDDEN,
        'SUPPORT_ACCESS_BLOCKED',
        'This school has blocked support access.',
      );
    }
    // Emergency entry exists only for a blocked school (#3802).
    if (emergency && mode !== SupportAccessMode.BLOCKED) {
      throw fail(HttpStatus.CONFLICT, 'EMERGENCY_NOT_ALLOWED', 'Emergency entry is not allowed.');
    }
    return this.repo.manager.transaction(async (m) => {
      await this.lockOwner(m, input.platformAdminId);
      await this.finalizeExpired(m, { platformAdminId: input.platformAdminId });
      await this.assertEligible(m, input);
      const active = mode === SupportAccessMode.ALLOWED || emergency;
      // D23: only a start that goes live replaces; an `ask` request (REQUESTED) never ends a live
      // session. The limit is checked before the replace so a refused start ends nothing.
      if (active) {
        await this.assertRoomForOneMore(m, input);
        await this.replaceOlderLive(m, input, null);
      }
      const now = new Date();
      const row = await m.save(
        ImpersonationSession,
        m.create(ImpersonationSession, {
          platform_admin_id: input.platformAdminId,
          tenant_id: input.schoolId,
          target_user_id: input.targetUserId,
          role: input.role,
          status: active ? 'ACTIVE' : 'REQUESTED',
          entry_kind: input.entryKind,
          view_only: emergency ? true : input.viewOnly,
          write_locked: emergency,
          reason: input.reason,
          started_at: active ? now : null,
          expires_at: active ? new Date(now.getTime() + IMPERSONATION_MAX_MINUTES * 60_000) : null,
        }),
      );
      if (active) await this.goLive(m, row, now);
      return row;
    });
  }

  /** W3: an `ask` ticket was redeemed. Same live write and STARTED row as `create`. */
  async activate(sid: string): Promise<ImpersonationSession> {
    return this.repo.manager.transaction(async (m) => {
      const row = await m.findOne(ImpersonationSession, { where: { id: sid } });
      if (!row) throw fail(HttpStatus.NOT_FOUND, 'SESSION_NOT_FOUND', 'Session not found.');
      await this.lockOwner(m, row.platform_admin_id);
      const mode = (await this.settings.supportAccessFresh(row.tenant_id)).mode;
      if (mode === SupportAccessMode.BLOCKED && row.entry_kind === ImpersonationEntryKind.NORMAL) {
        throw fail(
          HttpStatus.FORBIDDEN,
          'SUPPORT_ACCESS_BLOCKED',
          'This school has blocked support access.',
        );
      }
      await this.finalizeExpired(m, { platformAdminId: row.platform_admin_id });
      const who = {
        platformAdminId: row.platform_admin_id,
        schoolId: row.tenant_id,
        targetUserId: row.target_user_id,
        role: row.role as UserRole,
      };
      // D26 again: the person may have been suspended or removed since the ticket was approved.
      await this.assertEligible(m, who);
      await this.assertRoomForOneMore(m, who);
      const now = new Date();
      const expires = new Date(now.getTime() + IMPERSONATION_MAX_MINUTES * 60_000);
      const done = await this.rowsOf(
        m.query(
          `UPDATE impersonation_sessions
              SET status = 'ACTIVE', started_at = $2, expires_at = $3
            WHERE id = $1 AND status = 'APPROVED'
              AND (ticket_expires_at IS NULL OR ticket_expires_at > $2)
        RETURNING id`,
          [sid, now, expires],
        ),
      );
      if (done.length === 0) {
        throw fail(
          HttpStatus.CONFLICT,
          'SESSION_NOT_ACTIVATABLE',
          'This session cannot be started.',
        );
      }
      // Replace only after the ticket update won, so a 409 above has deleted no key.
      await this.replaceOlderLive(m, who, sid);
      row.status = 'ACTIVE';
      row.started_at = now;
      row.expires_at = expires;
      await this.goLive(m, row, now);
      return row;
    });
  }

  /** #3799: the owner's write request was approved. */
  async grantWrite(sid: string): Promise<void> {
    const notLive = () => fail(HttpStatus.CONFLICT, 'SESSION_NOT_LIVE', 'This session is not live.');
    const live = await this.repo.manager.transaction(async (m) => {
      const rows: ImpersonationSession[] = await this.rowsOf(
        m.query(
          `UPDATE impersonation_sessions
              SET write_locked = false, view_only = false, write_requested_at = NULL
            WHERE id = $1 AND status = 'ACTIVE' AND expires_at > now()
        RETURNING platform_admin_id, target_user_id, tenant_id, role, view_only, entry_kind, write_locked`,
          [sid],
        ),
      );
      if (rows.length === 0) throw notLive();
      return rows[0];
    });
    // After COMMIT: a failed Redis write leaves the session locked (fails closed), never unlocked
    // in Redis with a locked row. XX: a key that ended meanwhile is never recreated (409).
    // KEEPTTL: the hard cap stays.
    const set = await this.redisOp(() => this.redis.set(impKey(sid), liveJson(live), 'KEEPTTL', 'XX'));
    if (set !== 'OK') throw notLive();
  }

  /** Ends one session. Returns false when it was already over (nothing written). */
  async end(sid: string, endedBy: ImpersonationEndedBy): Promise<boolean> {
    return this.repo.manager.transaction(async (m) => {
      await this.finalizeExpired(m, { id: sid });
      return (await this.endRows(m, 'id = $3', [sid], endedBy)) > 0;
    });
  }

  revokeAllForSchool(schoolId: string, endedBy: ImpersonationEndedBy): Promise<number> {
    return this.repo.manager.transaction(async (m) => {
      await this.finalizeExpired(m, { schoolId });
      return this.endRows(m, 'tenant_id = $3', [schoolId], endedBy);
    });
  }

  revokeAllForAdmin(adminId: string, endedBy: ImpersonationEndedBy): Promise<number> {
    return this.repo.manager.transaction(async (m) => {
      await this.finalizeExpired(m, { platformAdminId: adminId });
      return this.endRows(m, 'platform_admin_id = $3', [adminId], endedBy);
    });
  }

  async listLive(adminId?: string): Promise<ImpersonationSessionDto[]> {
    await this.repo.manager.transaction((m) =>
      this.finalizeExpired(m, adminId ? { platformAdminId: adminId } : {}),
    );
    const qb = this.baseList().where('s.status = :st', { st: 'ACTIVE' });
    if (adminId) qb.andWhere('s.platform_admin_id = :adminId', { adminId });
    return this.toDtos(await qb.orderBy('s.started_at', 'DESC').getRawAndEntities());
  }

  async listRecent(opts: {
    schoolId?: string;
    adminId?: string;
    limit: number;
  }): Promise<ImpersonationSessionDto[]> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), LIST_LIMIT_MAX);
    await this.repo.manager.transaction((m) =>
      this.finalizeExpired(m, {
        ...(opts.schoolId ? { schoolId: opts.schoolId } : {}),
        ...(opts.adminId ? { platformAdminId: opts.adminId } : {}),
      }),
    );
    const qb = this.baseList().where('1 = 1');
    if (opts.schoolId) qb.andWhere('s.tenant_id = :schoolId', { schoolId: opts.schoolId });
    if (opts.adminId) qb.andWhere('s.platform_admin_id = :adminId', { adminId: opts.adminId });
    return this.toDtos(await qb.orderBy('s.created_at', 'DESC').limit(limit).getRawAndEntities());
  }

  // ---- internals ----

  private baseList() {
    return (
      this.repo
        .createQueryBuilder('s')
        // Before the joins (TypeORM reads it per join): history keeps names after a soft delete.
        .withDeleted()
        .innerJoin('s.platform_admin', 'pa')
        .innerJoin('pa.user', 'au')
        .innerJoin('s.tenant', 't')
        .innerJoin('s.target_user', 'tu')
        .addSelect(['au.full_name', 't.name', 'tu.full_name'])
    );
  }

  private toDtos(res: { entities: ImpersonationSession[]; raw: any[] }): ImpersonationSessionDto[] {
    const now = new Date();
    const names = new Map<string, any>(res.raw.map((r) => [r.s_id, r]));
    return res.entities.map((s) => {
      const n = names.get(s.id);
      return {
        id: s.id,
        schoolId: s.tenant_id,
        schoolName: n?.t_name,
        platformAdminId: s.platform_admin_id,
        platformAdminName: n?.au_full_name,
        userId: s.target_user_id,
        userName: n?.tu_full_name,
        role: s.role as UserRole,
        status: shownStatus(s, now),
        kind: s.entry_kind as ImpersonationEntryKind,
        viewOnly: s.view_only,
        reason: s.reason,
        requestedAt: s.requested_at.toISOString(),
        startedAt: s.started_at?.toISOString() ?? null,
        endedAt: s.ended_at?.toISOString() ?? null,
        endedBy: s.ended_by as ImpersonationEndedBy | null,
        expiresAt: s.expires_at?.toISOString() ?? null,
      };
    });
  }

  /** Serialises one owner's starts so the live limit and the replace rule cannot be raced past. */
  private lockOwner(m: EntityManager, adminId: string) {
    return m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`imp:${adminId}`]);
  }

  private async takeRateToken(adminId: string): Promise<void> {
    const key = rateKey(adminId);
    // Fail closed: a missing result, a per-command error or a non-integer count is a Redis fault, not "under the limit".
    const [count, ttl] = await this.redisOp(async () => {
      const res = await this.redis.multi().incr(key).ttl(key).exec();
      if (!res || res.length !== 2 || res.some(([err]) => err))
        throw new Error('rate-limit command failed');
      const n = Number(res[0][1]);
      if (!Number.isInteger(n)) throw new Error('rate-limit count invalid');
      return [n, Number(res[1][1])];
    });
    // A counter that lost its expiry (crash between INCR and EXPIRE) must not lock the admin out forever.
    if (ttl < 0) await this.redisOp(() => this.redis.expire(key, RATE_WINDOW_SEC));
    if (count > IMPERSONATION_RATE_LIMIT) {
      throw fail(
        HttpStatus.TOO_MANY_REQUESTS,
        'IMPERSONATION_RATE_LIMITED',
        'Too many sign-ins as another person. Try again later.',
      );
    }
  }

  /** D26: school exists; person ACTIVE, undeleted, holds the role here; not SUPER_ADMIN; not a platform admin. */
  private async assertEligible(
    m: EntityManager,
    i: Pick<CreateImpersonationInput, 'schoolId' | 'targetUserId' | 'role'>,
  ): Promise<void> {
    if (!(await m.exists(School, { where: { id: i.schoolId } }))) {
      throw fail(HttpStatus.NOT_FOUND, 'SCHOOL_NOT_FOUND', 'School not found.');
    }
    const user = await m.findOne(User, { where: { id: i.targetUserId } });
    const ok =
      user &&
      user.status === UserStatus.ACTIVE &&
      i.role !== UserRole.SUPER_ADMIN &&
      (await m.exists(UserTenant, {
        where: { user_id: i.targetUserId, tenant_id: i.schoolId, role: i.role },
      })) &&
      !(await m.exists(PlatformAdmin, { where: { user_id: i.targetUserId } }));
    if (!ok) throw fail(HttpStatus.UNPROCESSABLE_ENTITY, 'PERSON_NOT_ELIGIBLE', PERSON_REFUSED);
  }

  /** D23: a 4th distinct live session of one owner is refused. A same-person start replaces, so it adds none. */
  private async assertRoomForOneMore(
    m: EntityManager,
    i: Pick<CreateImpersonationInput, 'platformAdminId' | 'schoolId' | 'targetUserId'>,
  ): Promise<void> {
    const live = await m.find(ImpersonationSession, {
      where: { platform_admin_id: i.platformAdminId, status: 'ACTIVE' },
    });
    const others = live.filter(
      (r) => !(r.tenant_id === i.schoolId && r.target_user_id === i.targetUserId),
    );
    if (others.length >= IMPERSONATION_MAX_LIVE) {
      throw fail(
        HttpStatus.CONFLICT,
        'TOO_MANY_LIVE_SESSIONS',
        'Too many sessions are open. End one first.',
      );
    }
  }

  /**
   * D23: a start that goes live replaces the owner's older live row of the same (school, person).
   * `exceptId` keeps the row being activated out of it.
   */
  private async replaceOlderLive(
    m: EntityManager,
    i: Pick<CreateImpersonationInput, 'platformAdminId' | 'schoolId' | 'targetUserId'>,
    exceptId: string | null,
  ): Promise<void> {
    await this.endRows(
      m,
      "platform_admin_id = $3 AND tenant_id = $4 AND target_user_id = $5 AND status = 'ACTIVE' AND id IS DISTINCT FROM $6::uuid",
      [i.platformAdminId, i.schoolId, i.targetUserId, exceptId],
      ImpersonationEndedBy.REPLACED,
    );
  }

  /** Writes the STARTED row and `imp:<sid>` (EX = remaining seconds) inside the transaction. */
  private async goLive(m: EntityManager, row: ImpersonationSession, now: Date): Promise<void> {
    const ttl = Math.max(1, Math.ceil((row.expires_at!.getTime() - now.getTime()) / 1000));
    await this.audit.record(
      {
        action: AuditAction.IMPERSONATION_STARTED,
        entity_type: 'ImpersonationSession',
        entity_id: row.id,
        tenant_id: row.tenant_id,
        performed_by_user_id: row.platform_admin_id,
        new_values: {
          role: row.role,
          target_user_id: row.target_user_id,
          view_only: row.view_only,
          kind: row.entry_kind,
          reason: row.reason,
        },
      },
      m,
    );
    // If Redis rejects, the row and STARTED roll back: no row without a key.
    // ponytail: a failed COMMIT after this SET leaves one orphan key for at most its TTL (60 min).
    await this.redisOp(() => this.redis.set(impKey(row.id), liveJson(row), 'EX', ttl));
  }

  /**
   * Ends every open row matching `where` (params start at $3) in one conditional UPDATE. Only the
   * winner of that UPDATE gets a row back, so it alone writes the ENDED row and deletes the key:
   * each end path writes exactly one.
   */
  private async endRows(
    m: EntityManager,
    where: string,
    params: unknown[],
    endedBy: ImpersonationEndedBy,
  ): Promise<number> {
    const rows: EndedRow[] = await this.rowsOf(
      m.query(
        `UPDATE impersonation_sessions
            SET status = $1, ended_at = now(), ended_by = $2
          WHERE ${where} AND status IN (${OPEN_STATUSES})
      ${RETURNING}`,
        [ImpersonationStatus.ENDED, endedBy, ...params],
      ),
    );
    for (const r of rows) {
      await this.auditEnded(m, r, endedBy);
      // ponytail: DEL runs before COMMIT on purpose (fail-safe): a rollback can leave a live row with no key (session dead), never a dead row with a live key.
      await this.redisOp(() => this.redis.del(impKey(r.id)));
    }
    return rows.length;
  }

  /**
   * D31: lazy expiry. ACTIVE rows past `expires_at` flip to EXPIRED and get their missing ENDED row,
   * once. The key already left Redis by TTL.
   * ponytail: no scheduler (D31). A row nobody lists, creates on or ends stays ACTIVE in the table;
   * `shownStatus` hides that from every reader. Add a repeatable job if a report needs it exact at rest.
   */
  private async finalizeExpired(
    m: EntityManager,
    scope: { id?: string; schoolId?: string; platformAdminId?: string },
  ): Promise<void> {
    const params: unknown[] = [];
    const conds = ["status = 'ACTIVE'", 'expires_at <= now()'];
    for (const [col, v] of [
      ['id', scope.id],
      ['tenant_id', scope.schoolId],
      ['platform_admin_id', scope.platformAdminId],
    ] as const) {
      if (v) {
        params.push(v);
        conds.push(`${col} = $${params.length + 2}`);
      }
    }
    const rows: EndedRow[] = await this.rowsOf(
      m.query(
        `UPDATE impersonation_sessions
            SET status = $1, ended_at = expires_at, ended_by = $2
          WHERE id IN (
                SELECT id FROM impersonation_sessions
                 WHERE ${conds.join(' AND ')} ORDER BY id FOR UPDATE)
      ${RETURNING}`,
        [ImpersonationStatus.EXPIRED, ImpersonationEndedBy.EXPIRED, ...params],
      ),
    );
    for (const r of rows) await this.auditEnded(m, r, ImpersonationEndedBy.EXPIRED);
  }

  private auditEnded(m: EntityManager, r: EndedRow, endedBy: ImpersonationEndedBy) {
    return this.audit.record(
      {
        action: AuditAction.IMPERSONATION_ENDED,
        entity_type: 'ImpersonationSession',
        entity_id: r.id,
        tenant_id: r.tenant_id,
        performed_by_user_id: r.platform_admin_id,
        new_values: { ended_by: endedBy, role: r.role, target_user_id: r.target_user_id },
      },
      m,
    );
  }

  /** TypeORM's postgres driver answers UPDATE ... RETURNING as `[rows, count]`. */
  private async rowsOf(q: Promise<unknown>): Promise<any[]> {
    const out = (await q) as any[];
    return Array.isArray(out[0]) ? out[0] : out;
  }

  /** Any Redis failure is a 503 with the fixed sentence; the error text is logged, never returned. */
  private async redisOp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error(
        `Impersonation Redis failure: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw fail(HttpStatus.SERVICE_UNAVAILABLE, 'REDIS_UNAVAILABLE', REDIS_DOWN);
    }
  }
}
