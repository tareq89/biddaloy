import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { attentionEvents } from '../../attention/attention.constants';
import { emitRecheck } from '../../attention/engine/attention-events';
import { AuditService } from '../../audit/audit.service';
import type { RequestContext } from '../../../common/request-context.util';
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import { SupportAccessNoticeService } from '../notices/support-access-notice.service';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import {
  SUPPORT_REQUESTS_LIMIT_MAX,
  SupportRequestListStatus,
  type SupportRequestDecisionDto,
  type SupportRequestItemDto,
} from './dto/support-requests.dto';

/** TypeORM's pg driver answers UPDATE ... RETURNING as [rows, count]; a SELECT as rows. */
const rowsOf = <T>(r: unknown): T[] =>
  (Array.isArray(r) && typeof r[1] === 'number' && Array.isArray(r[0]) ? r[0] : r) as T[];

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

const alreadyDecided = () =>
  new ConflictException({
    message: 'This request has already been decided.',
    details: { code: 'ALREADY_DECIDED' },
  });

// A request is a REQUESTED row (ASK, lazily expired after 24 h, D31), or a live read-only
// EMERGENCY row whose owner asked to write (WRITE, D22). Fixed fragments, never user input.
const IS_ASK = `s.status = 'REQUESTED' AND s.entry_kind = 'NORMAL' AND s.requested_at > now() - interval '24 hours'`;
const IS_WRITE = `s.status = 'ACTIVE' AND s.entry_kind = 'EMERGENCY' AND s.write_requested_at IS NOT NULL
  AND s.write_locked AND s.expires_at > now()`;

const SELECT_REQUEST = `SELECT s.id, s.entry_kind, s.role, s.reason, s.requested_at, s.write_locked, s.status,
              owner.full_name AS owner_name, person.full_name AS person_name,
              CASE WHEN s.entry_kind = 'EMERGENCY' THEN s.expires_at
                   ELSE s.requested_at + interval '24 hours' END AS expires_at,
              ((${IS_ASK}) OR (${IS_WRITE})) AS pending,
              (s.status = 'REQUESTED' AND NOT (${IS_ASK})) AS expired_ask
         FROM impersonation_sessions s
         JOIN users owner ON owner.id = s.platform_admin_id
         JOIN users person ON person.id = s.target_user_id`;

interface Row {
  id: string;
  entry_kind: string;
  owner_name: string;
  role: string;
  person_name: string;
  reason: string;
  requested_at: Date;
  expires_at: Date | null;
  status: string;
  write_locked: boolean;
  pending: boolean;
  expired_ask: boolean;
}

/**
 * [99.3.03] A school admin sees and decides Biddaloy's requests (D20: rows of impersonation_sessions,
 * no requests table). First decision wins (D21): every decision is one conditional UPDATE.
 */
@Injectable()
export class SupportRequestsService {
  constructor(
    @InjectRepository(ImpersonationSession) private readonly repo: Repository<ImpersonationSession>,
    private readonly audit: AuditService,
    private readonly sessions: ImpersonationSessionService,
    private readonly notices: SupportAccessNoticeService,
  ) {}

  async list(
    schoolId: string,
    status: SupportRequestListStatus = SupportRequestListStatus.PENDING,
    limit = 50,
    page = 1,
  ): Promise<SupportRequestItemDto[]> {
    const lim = Math.min(Math.max(Math.trunc(limit) || 1, 1), SUPPORT_REQUESTS_LIMIT_MAX);
    const offset = (Math.min(Math.max(Math.trunc(page) || 1, 1), 10000) - 1) * lim;
    const filter =
      status === SupportRequestListStatus.PENDING
        ? `((${IS_ASK}) OR (${IS_WRITE}))`
        : `(s.decided_at IS NOT NULL OR (s.status = 'REQUESTED' AND NOT (${IS_ASK})))
           AND NOT (${IS_WRITE})`;
    const rows: Row[] = await this.repo.query(
      `${SELECT_REQUEST}
        WHERE s.tenant_id = $1 AND ${filter}
        ORDER BY s.requested_at DESC
        LIMIT $2 OFFSET $3`,
      [schoolId, lim, offset],
    );
    return rows.map((r) => this.item(r));
  }

  /** One request of this school by id; another school's id is the same 404 as a missing one. */
  async get(schoolId: string, id: string): Promise<SupportRequestItemDto> {
    const rows: Row[] = await this.repo.query(
      `${SELECT_REQUEST}
        WHERE s.tenant_id = $1 AND s.id = $2
          AND (s.decided_at IS NOT NULL OR s.status = 'REQUESTED' OR (${IS_WRITE}))`,
      [schoolId, id],
    );
    if (!rows[0]) throw new NotFoundException('Request not found.');
    return this.item(rows[0]);
  }

  private item(r: Row): SupportRequestItemDto {
    return {
      id: r.id,
      kind: r.entry_kind === 'EMERGENCY' ? 'WRITE' : 'ASK',
      ownerName: r.owner_name,
      role: r.role,
      personName: r.person_name,
      reason: r.reason,
      requestedAt: new Date(r.requested_at).toISOString(),
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      status: this.shown(r),
    };
  }

  private shown(r: Row): SupportRequestItemDto['status'] {
    if (r.pending) return 'REQUESTED';
    if (r.expired_ask) return 'EXPIRED';
    if (r.entry_kind === 'EMERGENCY') return r.write_locked ? 'DENIED' : 'APPROVED';
    return r.status === 'DENIED' ? 'DENIED' : 'APPROVED';
  }

  async approve(
    schoolId: string,
    adminId: string,
    id: string,
    ctx: RequestContext = NO_CONTEXT,
  ): Promise<SupportRequestDecisionDto> {
    await this.decide(schoolId, adminId, id, true, ctx);
    return { id, status: 'APPROVED' };
  }

  async deny(
    schoolId: string,
    adminId: string,
    id: string,
    ctx: RequestContext = NO_CONTEXT,
  ): Promise<SupportRequestDecisionDto> {
    await this.decide(schoolId, adminId, id, false, ctx);
    return { id, status: 'DENIED' };
  }

  private async decide(
    schoolId: string,
    adminId: string,
    id: string,
    approve: boolean,
    ctx: RequestContext,
  ): Promise<void> {
    // ASK first; zero rows then WRITE. Both are single guarded UPDATEs, so the first decision wins.
    const ask = await this.repo.manager.transaction(async (m) => {
      const rows = rowsOf<{ platform_admin_id: string }>(
        await m.query(
          `UPDATE impersonation_sessions s
            SET status = $4, decided_by = $3, decided_at = now(),
                ticket_expires_at = ${approve ? `now() + interval '24 hours'` : 'NULL'}
          WHERE s.id = $1 AND s.tenant_id = $2 AND ${IS_ASK}
      RETURNING s.platform_admin_id`,
          [id, schoolId, adminId, approve ? 'APPROVED' : 'DENIED'],
        ),
      );
      if (rows.length === 0) return null;
      await this.record(m, approve, id, 'ASK', schoolId, adminId, ctx);
      return rows[0];
    });
    if (ask) {
      emitRecheck(attentionEvents, {
        tenantId: schoolId,
        ruleKey: 'support.access_request',
        actorUserId: adminId,
      });
      if (approve) await this.tellOwner(ask.platform_admin_id, schoolId);
      return;
    }

    // The claim clears the marker, so a second admin's claim finds no row. A denied write keeps the
    // session read-only and alive (DENIED would end it); only the marker goes.
    const claimed = rowsOf<{ id: string }>(
      await this.repo.query(
        `UPDATE impersonation_sessions s
          SET write_requested_at = NULL, decided_by = $3, decided_at = now()
        WHERE s.id = $1 AND s.tenant_id = $2 AND ${IS_WRITE}
    RETURNING s.id`,
        [id, schoolId, adminId],
      ),
    );
    if (claimed.length === 0) return this.refuse(id, schoolId);
    if (approve) {
      try {
        await this.sessions.grantWrite(id);
      } catch (e) {
        // The session ended between the claim and the grant: nothing was granted.
        if (e instanceof HttpException && e.getStatus() === 409) throw alreadyDecided();
        // Redis (or the DB) failed: grantWrite rolled back, so put the request back for a retry
        // instead of consuming it while the session stays read-only.
        await this.repo.query(
          `UPDATE impersonation_sessions
              SET write_requested_at = now(), decided_by = NULL, decided_at = NULL
            WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE' AND write_locked
              AND write_requested_at IS NULL`,
          [id, schoolId],
        );
        throw e;
      }
    }
    await this.record(this.repo.manager, approve, id, 'WRITE', schoolId, adminId, ctx);
  }

  /** Zero rows: another school's row looks like no row (404); this school's lost the race (409). */
  private async refuse(id: string, schoolId: string): Promise<never> {
    const own: unknown[] = await this.repo.query(
      'SELECT 1 FROM impersonation_sessions WHERE id = $1 AND tenant_id = $2',
      [id, schoolId],
    );
    if (own.length === 0) throw new NotFoundException('Request not found');
    throw alreadyDecided();
  }

  private record(
    m: EntityManager,
    approve: boolean,
    id: string,
    kind: 'ASK' | 'WRITE',
    schoolId: string,
    adminId: string,
    ctx: RequestContext,
  ) {
    return this.audit.record(
      {
        action: approve ? AuditAction.SUPPORT_ACCESS_APPROVED : AuditAction.SUPPORT_ACCESS_DENIED,
        entity_type: 'ImpersonationSession',
        entity_id: id,
        tenant_id: schoolId,
        performed_by_user_id: adminId,
        ip_address: ctx.ip,
        user_agent: ctx.userAgent,
        new_values: { sessionId: id, kind },
      },
      m,
    );
  }

  private async tellOwner(ownerId: string, schoolId: string): Promise<void> {
    const rows: { name: string; email: string | null; phone: string | null; school: string }[] =
      await this.repo.query(
        `SELECT u.full_name AS name, u.email, u.phone, sc.name AS school
           FROM users u, schools sc WHERE u.id = $1 AND sc.id = $2`,
        [ownerId, schoolId],
      );
    if (rows[0]) {
      const { school, ...owner } = rows[0];
      await this.notices.ticketReady(owner, schoolId, school);
    }
  }
}
