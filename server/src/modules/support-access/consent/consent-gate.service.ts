import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ApprovalScope,
  AuditAction,
  ImpersonationEntryKind,
  SupportAccessMode,
  UserRole,
} from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { PlatformAdminService } from '../../platform-identity/platform-admin.service';
import { TwoPersonGuard } from '../../platform-identity/approvals/two-person.guard';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import {
  SupportAccessNoticeService,
  type SupportEntry,
} from '../notices/support-access-notice.service';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';

/** The request fields `TwoPersonGuard.enforce` reads, plus the signed-in owner. */
export interface GateRequest {
  user: { sub: string };
  method: string;
  originalUrl: string;
  headers: Record<string, unknown>;
  body: unknown;
}

export interface GateStartInput {
  schoolId: string;
  targetUserId: string;
  role: UserRole;
  reason: string;
  viewOnly: boolean;
  ticketId?: string;
}

const rowsOf = <T>(r: unknown): T[] =>
  (Array.isArray(r) && typeof r[1] === 'number' && Array.isArray(r[0]) ? r[0] : r) as T[];

// One body for every "this ticket cannot be used" reason (Rule 23: no oracle, no echo).
const ticketNotUsable = () =>
  new ConflictException({
    message: 'This request cannot be used.',
    details: { code: 'TICKET_NOT_USABLE' },
  });

/**
 * [99.3.05] Starting a Login as follows the school's mode: `allowed` opens at once, `ask` waits for
 * an admin, `blocked` is a read-only emergency entry behind the other owner's approval.
 * Which school's setting is read comes only from the body's schoolId (never X-Tenant-ID).
 */
@Injectable()
export class ConsentGateService {
  constructor(
    @InjectRepository(ImpersonationSession) private readonly repo: Repository<ImpersonationSession>,
    private readonly sessions: ImpersonationSessionService,
    private readonly settings: SchoolSettingsReader,
    private readonly notices: SupportAccessNoticeService,
    private readonly twoPerson: TwoPersonGuard,
    private readonly owners: PlatformAdminService,
    private readonly audit: AuditService,
  ) {}

  async start(req: GateRequest, input: GateStartInput): Promise<ImpersonationSession> {
    const ownerId = req.user.sub;
    if (input.ticketId) return this.redeem(ownerId, input);

    const mode = (await this.settings.supportAccessFresh(input.schoolId)).mode;
    const base = {
      platformAdminId: ownerId,
      schoolId: input.schoolId,
      targetUserId: input.targetUserId,
      role: input.role,
      reason: input.reason,
    };
    if (mode === SupportAccessMode.BLOCKED) {
      // Before create: a pending approval takes no rate token.
      // ponytail: consume happens before create, so a later 409 from create spends the grant.
      await this.twoPerson.enforce(req, ApprovalScope.PLATFORM_LOGIN_AS, {
        action: 'login_as_emergency',
        schoolId: input.schoolId,
        targetUserId: input.targetUserId,
        role: input.role,
        reason: input.reason,
      });
      const row = await this.sessions.create({
        ...base,
        viewOnly: true,
        entryKind: ImpersonationEntryKind.EMERGENCY,
      });
      await this.tell(row, input, (e) => this.notices.emergency(input.schoolId, e), true);
      return row;
    }
    const row = await this.sessions.create({
      ...base,
      viewOnly: input.viewOnly,
      entryKind: ImpersonationEntryKind.NORMAL,
    });
    if (mode === SupportAccessMode.ASK) {
      await this.tell(
        row,
        input,
        (e) => this.notices.requestToAdmins(input.schoolId, row.id, e),
        false,
      );
    } else {
      await this.tell(row, input, (e) => this.notices.sessionStarted(input.schoolId, e), true);
    }
    return row;
  }

  /** Pre-check (identical 409 for every reason), then `activate`, the single-use conditional UPDATE. */
  private async redeem(ownerId: string, i: GateStartInput): Promise<ImpersonationSession> {
    const ok = await this.repo.query(
      `SELECT 1 FROM impersonation_sessions
        WHERE id = $1 AND platform_admin_id = $2 AND tenant_id = $3 AND target_user_id = $4
          AND role = $5 AND status = 'APPROVED' AND entry_kind = 'NORMAL'
          AND ticket_expires_at > now()`,
      [i.ticketId, ownerId, i.schoolId, i.targetUserId, i.role],
    );
    if (ok.length === 0) throw ticketNotUsable();
    let row: ImpersonationSession;
    try {
      row = await this.sessions.activate(i.ticketId!);
    } catch (e) {
      if (
        e instanceof HttpException &&
        (e.getResponse() as { code?: string }).code === 'SESSION_NOT_ACTIVATABLE'
      ) {
        throw ticketNotUsable();
      }
      throw e;
    }
    await this.tell(row, i, (e) => this.notices.sessionStarted(i.schoolId, e), true);
    return row;
  }

  /** Guarded UPDATE: only this owner's live, locked EMERGENCY session with no open request. */
  async requestWrite(ownerId: string, sid: string, reason: string): Promise<void> {
    const rows = rowsOf<{ tenant_id: string; role: string }>(
      await this.repo.query(
        `UPDATE impersonation_sessions SET write_requested_at = now()
          WHERE id = $1 AND platform_admin_id = $2 AND status = 'ACTIVE'
            AND entry_kind = 'EMERGENCY' AND write_locked AND write_requested_at IS NULL
            AND expires_at > now()
        RETURNING tenant_id, role`,
        [sid, ownerId],
      ),
    );
    if (rows.length === 0) {
      const own = await this.repo.query(
        'SELECT 1 FROM impersonation_sessions WHERE id = $1 AND platform_admin_id = $2',
        [sid, ownerId],
      );
      if (own.length === 0) throw new NotFoundException('Session not found.');
      throw new ConflictException({
        message: 'Write access cannot be requested for this session.',
        details: { code: 'WRITE_REQUEST_NOT_POSSIBLE' },
      });
    }
    const r = rows[0];
    await this.audit.record({
      action: AuditAction.SUPPORT_ACCESS_REQUESTED,
      entity_type: 'ImpersonationSession',
      entity_id: sid,
      tenant_id: r.tenant_id,
      performed_by_user_id: ownerId,
      new_values: { sessionId: sid, kind: 'WRITE' },
    });
    try {
      const e = await this.entry(ownerId, r.tenant_id, r.role, reason);
      if (e) await this.notices.requestToAdmins(r.tenant_id, sid, e.entry);
    } catch {
      // best effort
    }
  }

  /** Names for the messages; a lookup failure never fails the start (notices are best effort). */
  private async tell(
    row: ImpersonationSession,
    i: GateStartInput,
    toAdmins: (e: SupportEntry) => Promise<void>,
    toOwners: boolean,
  ): Promise<void> {
    try {
      const e = await this.entry(row.platform_admin_id, row.tenant_id, i.role, i.reason);
      if (!e) return;
      await toAdmins(e.entry);
      if (!toOwners) return;
      const ids = await this.owners.activeOwnerIds();
      const people: { name: string; email: string | null; phone: string | null }[] =
        ids.length === 0
          ? []
          : await this.repo.query(
              'SELECT full_name AS name, email, phone FROM users WHERE id = ANY($1::uuid[])',
              [ids],
            );
      await this.notices.ownersSessionStarted(people, { ...e.entry, targetSchool: e.school });
    } catch {
      // best effort
    }
  }

  private async entry(ownerId: string, schoolId: string, role: string, reason: string) {
    const rows: { name: string; school: string }[] = await this.repo.query(
      `SELECT u.full_name AS name, sc.name AS school
         FROM users u, schools sc WHERE u.id = $1 AND sc.id = $2`,
      [ownerId, schoolId],
    );
    if (!rows[0]) return null;
    const entry: SupportEntry = {
      person: rows[0].name,
      role,
      reason,
      time: new Date().toUTCString(),
    };
    return { school: rows[0].school, entry };
  }
}
