import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { shownStatus } from '../../support-access/sessions/impersonation-session.service';
import type {
  ListLoginAsSessionsQueryDto,
  LoginAsSessionItem,
  Page,
  PlatformAuditItem,
  SearchPlatformAuditQueryDto,
} from './dto/platform-audit.dto';

const BAD_CURSOR = 'Invalid cursor';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Postgres timestamptz text, e.g. 2026-11-12 10:00:00.123456+00 (kept as text: JS Dates lose microseconds).
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

const encode = (ts: string, id: string) =>
  Buffer.from(JSON.stringify([ts, id])).toString('base64url');

function decode(cursor?: string): [string | null, string | null] {
  if (!cursor) return [null, null];
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      typeof v[1] === 'string' &&
      TS_RE.test(v[0]) &&
      UUID_RE.test(v[1])
    )
      return [v[0], v[1]];
  } catch {
    /* fall through */
  }
  throw new BadRequestException(BAD_CURSOR);
}

const take = (limit?: number) => Math.min(Math.max(limit ?? 25, 1), 100);

/**
 * [Epic 99] Owner-only reads across every school. Never selects old_values/new_values.
 * All SQL is literal: every filter is `($n IS NULL OR col = $n)` so nothing is interpolated.
 */
@Injectable()
export class PlatformAuditService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async search(q: SearchPlatformAuditQueryDto): Promise<Page<PlatformAuditItem>> {
    const n = take(q.limit);
    const [cts, cid] = decode(q.cursor);
    const rows: Array<{
      id: string;
      action: string;
      entity_type: string;
      tenant_id: string | null;
      school_name: string | null;
      actor_name: string | null;
      imp_name: string | null;
      session_id: string | null;
      ts: string;
    }> = await this.ds.query(
      `SELECT a.id, a.action::text AS action, a.entity_type, a.tenant_id, sc.name AS school_name,
              actor.full_name AS actor_name, imp.full_name AS imp_name,
              a.impersonation_session_id AS session_id, a.created_at::text AS ts
         FROM audit_logs a
         LEFT JOIN schools sc ON sc.id = a.tenant_id
         LEFT JOIN users actor ON actor.id = a.performed_by_user_id
         LEFT JOIN users imp ON imp.id = a.impersonated_by_platform_admin_id
        WHERE ($1::uuid IS NULL OR a.tenant_id = $1::uuid)
          AND ($2::text IS NULL OR a.action::text = $2::text)
          AND ($3::uuid IS NULL OR a.performed_by_user_id = $3::uuid)
          AND ($4::uuid IS NULL OR a.impersonation_session_id = $4::uuid)
          AND ($5::timestamptz IS NULL OR a.created_at >= $5::timestamptz)
          AND ($6::timestamptz IS NULL OR a.created_at <= $6::timestamptz)
          AND ($7::timestamptz IS NULL OR (a.created_at, a.id) < ($7::timestamptz, $8::uuid))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $9`,
      [
        q.tenantId ?? null,
        q.action ?? null,
        q.actorId ?? null,
        q.sessionId ?? null,
        q.from ?? null,
        q.to ?? null,
        cts,
        cid,
        n + 1,
      ],
    );
    const page = rows.slice(0, n);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entity_type,
        schoolName: r.tenant_id ? (r.school_name ?? 'Unknown school') : 'Platform',
        tenantId: r.tenant_id,
        actorName: r.actor_name,
        impersonatedByName: r.imp_name,
        sessionId: r.session_id,
        at: new Date(r.ts).toISOString(),
      })),
      nextCursor: rows.length > n && last ? encode(last.ts, last.id) : null,
    };
  }

  async sessions(q: ListLoginAsSessionsQueryDto): Promise<Page<LoginAsSessionItem>> {
    const n = take(q.limit);
    const [cts, cid] = decode(q.cursor);
    const rows: Array<{
      id: string;
      platform_admin_id: string;
      owner_name: string;
      tenant_id: string;
      school_name: string | null;
      role: string;
      person_name: string;
      reason: string | null;
      entry_kind: string;
      started_at: Date | null;
      ended_at: Date | null;
      status: string;
      expires_at: Date | null;
      ts: string;
    }> = await this.ds.query(
      `SELECT s.id, s.platform_admin_id, owner.full_name AS owner_name, s.tenant_id,
              sc.name AS school_name, s.role, person.full_name AS person_name, s.reason,
              s.entry_kind, s.started_at, s.ended_at, s.status::text AS status, s.expires_at,
              s.requested_at::text AS ts
         FROM impersonation_sessions s
         JOIN users owner ON owner.id = s.platform_admin_id
         JOIN users person ON person.id = s.target_user_id
         LEFT JOIN schools sc ON sc.id = s.tenant_id
        WHERE ($1::uuid IS NULL OR s.tenant_id = $1::uuid)
          AND ($2::uuid IS NULL OR s.platform_admin_id = $2::uuid)
          AND ($3::text IS NULL OR CASE $3::text
                WHEN 'ACTIVE' THEN s.status::text = 'ACTIVE'
                  AND (s.expires_at IS NULL OR s.expires_at > now())
                WHEN 'EXPIRED' THEN s.status::text = 'EXPIRED'
                  OR (s.status::text = 'ACTIVE' AND s.expires_at <= now())
                ELSE s.status::text = $3::text END)
          AND ($4::timestamptz IS NULL OR (s.requested_at, s.id) < ($4::timestamptz, $5::uuid))
        ORDER BY s.requested_at DESC, s.id DESC
        LIMIT $6`,
      [q.tenantId ?? null, q.ownerId ?? null, q.status ?? null, cts, cid, n + 1],
    );
    const page = rows.slice(0, n);
    const counts: { sid: string; n: string }[] = page.length
      ? await this.ds.query(
          `SELECT impersonation_session_id AS sid, count(*) AS n
             FROM audit_logs
            WHERE impersonation_session_id = ANY($1::uuid[])
              AND action::text NOT IN ('IMPERSONATION_STARTED','IMPERSONATION_ENDED')
            GROUP BY impersonation_session_id`,
          [page.map((r) => r.id)],
        )
      : [];
    const byId = new Map(counts.map((c) => [c.sid, Number(c.n)]));
    const now = new Date();
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        ownerId: r.platform_admin_id,
        ownerName: r.owner_name,
        schoolId: r.tenant_id,
        schoolName: r.school_name ?? 'Unknown school',
        role: r.role,
        personName: r.person_name,
        reason: r.reason,
        entryKind: r.entry_kind,
        startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
        endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
        status: shownStatus(
          { status: r.status, expires_at: r.expires_at ? new Date(r.expires_at) : null },
          now,
        ),
        changedCount: byId.get(r.id) ?? 0,
      })),
      nextCursor: rows.length > n && last ? encode(last.ts, last.id) : null,
    };
  }
}
