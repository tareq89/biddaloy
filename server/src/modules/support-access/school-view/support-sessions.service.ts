import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImpersonationEndedBy } from '@biddaloy/shared';
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import {
  ImpersonationSessionService,
  shownStatus,
} from '../sessions/impersonation-session.service';
import {
  SUPPORT_SESSIONS_DAYS_MAX,
  SUPPORT_SESSIONS_LIMIT_MAX,
  type EndSupportSessionResultDto,
  type PlatformActionItemDto,
  type SupportSessionItemDto,
} from './dto/support-sessions.dto';

const clamp = (n: number | undefined, def: number, max: number) =>
  Math.min(Math.max(Math.trunc(n ?? def) || def, 1), max);

/**
 * Whitelist of what a platform owner does to a school outside Login as: test -> label key. Never
 * "every platform-performed row": IMPERSONATION_* and SUPPORT_ACCESS_* rows are also written by
 * owners. [W4 adds its PLATFORM_* school actions here.] Fixed SQL fragments, no input.
 */
const PLATFORM_ACTIONS: { test: string; label: string }[] = [
  {
    test: `a.action::text = 'SUSPEND' AND a.entity_type = 'School'`,
    label: 'supportAccess.platformAction.suspended',
  },
  {
    test: `a.action::text = 'REACTIVATE' AND a.entity_type = 'School'`,
    label: 'supportAccess.platformAction.reactivated',
  },
  {
    test: `a.action::text = 'UPDATE' AND a.entity_type = 'School' AND a.new_values ? 'units'`,
    label: 'supportAccess.platformAction.smsCreditsChanged',
  },
  {
    test: `a.action::text = 'UPDATE' AND a.entity_type = 'School' AND a.new_values->>'event' = 'SEATS_GRANTED'`,
    label: 'supportAccess.platformAction.seatsGranted',
  },
];

interface SessionRow {
  id: string;
  owner_name: string;
  started_at: Date | null;
  requested_at: Date;
  ended_at: Date | null;
  status: string;
  expires_at: Date | null;
  entry_kind: string;
  view_only: boolean;
  role: string;
  person_name: string;
  reason: string;
}

type Q = { days?: number; page?: number; limit?: number };

const paging = (q: Q) => {
  const days = clamp(q.days, SUPPORT_SESSIONS_DAYS_MAX, SUPPORT_SESSIONS_DAYS_MAX);
  const limit = clamp(q.limit, 50, SUPPORT_SESSIONS_LIMIT_MAX);
  return { days, limit, offset: (clamp(q.page, 1, 10000) - 1) * limit };
};

/** [99.3.04] What the school admin sees of Login as: sessions, Biddaloy's own actions, end now. */
@Injectable()
export class SupportSessionsService {
  constructor(
    @InjectRepository(ImpersonationSession) private readonly repo: Repository<ImpersonationSession>,
    private readonly sessions: ImpersonationSessionService,
  ) {}

  async listSessions(schoolId: string, q: Q = {}): Promise<SupportSessionItemDto[]> {
    const { days, limit, offset } = paging(q);
    // Users joined raw (no deleted_at filter) so history survives a soft delete.
    const rows: SessionRow[] = await this.repo.query(
      `SELECT s.id, s.started_at, s.requested_at, s.ended_at, s.status, s.expires_at, s.entry_kind,
              s.view_only, s.role, s.reason,
              owner.full_name AS owner_name, person.full_name AS person_name
         FROM impersonation_sessions s
         JOIN users owner ON owner.id = s.platform_admin_id
         JOIN users person ON person.id = s.target_user_id
        WHERE s.tenant_id = $1
          AND s.status IN ('ACTIVE','ENDED','EXPIRED')
          AND s.requested_at >= now() - make_interval(days => $2::int)
        ORDER BY s.requested_at DESC, s.id DESC
        LIMIT $3 OFFSET $4`,
      [schoolId, days, limit, offset],
    );
    if (!rows.length) return [];
    const counts: { sid: string; n: string }[] = await this.repo.query(
      `SELECT impersonation_session_id AS sid, count(*) AS n
         FROM audit_logs
        WHERE impersonation_session_id = ANY($1::uuid[]) AND tenant_id = $2
          AND action::text NOT IN ('IMPERSONATION_STARTED','IMPERSONATION_ENDED')
        GROUP BY impersonation_session_id`,
      [rows.map((r) => r.id), schoolId],
    );
    const byId = new Map(counts.map((c) => [c.sid, Number(c.n)]));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      ownerName: r.owner_name,
      startedAt: new Date(r.started_at ?? r.requested_at).toISOString(),
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      status: shownStatus(
        { status: r.status, expires_at: r.expires_at ? new Date(r.expires_at) : null },
        now,
      ) as SupportSessionItemDto['status'],
      kind: r.entry_kind === 'EMERGENCY' ? 'EMERGENCY' : 'NORMAL',
      viewOnly: r.view_only,
      role: r.role,
      personName: r.person_name,
      reason: r.reason,
      changedCount: byId.get(r.id) ?? 0,
    }));
  }

  async listPlatformActions(schoolId: string, q: Q = {}): Promise<PlatformActionItemDto[]> {
    const { days, limit, offset } = paging(q);
    const labelCase = PLATFORM_ACTIONS.map((p) => `WHEN ${p.test} THEN '${p.label}'`).join(' ');
    const any = PLATFORM_ACTIONS.map((p) => `(${p.test})`).join(' OR ');
    const rows: {
      id: string;
      created_at: Date;
      actor: string;
      label: string;
      reason: string | null;
    }[] = await this.repo.query(
      `SELECT a.id, a.created_at, u.full_name AS actor, a.new_values->>'reason' AS reason,
              CASE ${labelCase} END AS label
         FROM audit_logs a
         JOIN users u ON u.id = a.performed_by_user_id
        WHERE a.tenant_id = $1
          AND a.performed_by_user_id IN (SELECT user_id FROM platform_admins)
          AND a.impersonation_session_id IS NULL
          AND a.created_at >= now() - make_interval(days => $2::int)
          AND (${any})
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $3 OFFSET $4`,
      [schoolId, days, limit, offset],
    );
    return rows.map((r) => ({
      id: r.id,
      at: new Date(r.created_at).toISOString(),
      actorName: r.actor,
      label: r.label,
      reason: r.reason || null,
    }));
  }

  /** 404 only for another school's or an unknown id (Rule 23: same answer). Already over: 200, idempotent. */
  async end(schoolId: string, id: string): Promise<EndSupportSessionResultDto> {
    const own = await this.repo.query(
      `SELECT 1 FROM impersonation_sessions WHERE id = $1 AND tenant_id = $2`,
      [id, schoolId],
    );
    if (!own.length) throw new NotFoundException('Session not found.');
    await this.sessions.end(id, ImpersonationEndedBy.SCHOOL_ADMIN);
    const row = await this.repo.findOneByOrFail({ id });
    return { id, status: shownStatus(row) };
  }
}
