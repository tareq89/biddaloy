import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AuditAction, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { PlatformApproval } from '../entities/platform-approval.entity';
import { PlatformAdminService } from '../platform-admin.service';
import { PlatformApprovalRow, PlatformApprovalStatus } from './dto/platform-approvals.dto';

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const DECIDE_REFUSED = 'This request can no longer be decided.';

export interface ApprovalPayload {
  method: string;
  path: string;
  body: unknown;
}

/** Stable JSON: object keys sorted at every depth, so key order never changes the hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const hashPayload = (p: ApprovalPayload): string =>
  createHash('sha256')
    .update(canonical({ method: p.method.toUpperCase(), path: p.path, body: p.body ?? null }))
    .digest('hex');

// TypeORM's pg driver returns `[rows, affected]` for UPDATE ... RETURNING.
function rowsOf(res: unknown): unknown[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? (res[0] as unknown[]) : (res as unknown[]);
}

/**
 * [Epic 98] Two-owner approvals. Every state change is one conditional UPDATE, so a retry or two
 * parallel calls can never double-use a grant. No sweep job: expiry is applied on read (ponytail,
 * add a sweep if the table ever grows). The routes carry no Idempotency-Key: decide and consume
 * are already single conditional UPDATEs, so a retry is safe (Rule 25 reason).
 */
@Injectable()
export class PlatformApprovalsService {
  private readonly logger = new Logger(PlatformApprovalsService.name);

  constructor(
    @InjectRepository(PlatformApproval) private readonly repo: Repository<PlatformApproval>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly owners: PlatformAdminService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly audit: AuditService,
  ) {}

  private async expireStale(): Promise<void> {
    await this.ds.query(
      `UPDATE platform_approvals SET status = 'EXPIRED'
       WHERE status IN ('PENDING','GRANTED') AND expires_at <= now()`,
    );
  }

  /** Creates a PENDING row and tells the other active owner once. A repeat of a live request reuses it. */
  async request(
    actorId: string,
    scope: string,
    payload: ApprovalPayload,
    summary: Record<string, unknown>,
  ): Promise<{ id: string }> {
    await this.expireStale();
    const payload_hash = hashPayload(payload);
    const live = await this.repo
      .createQueryBuilder('a')
      .where(
        `a.requested_by = :actorId AND a.scope = :scope AND a.payload_hash = :payload_hash
         AND a.status = 'PENDING' AND a.expires_at > now()`,
        { actorId, scope, payload_hash },
      )
      .getOne();
    if (live) return { id: live.id };

    const row = await this.repo.save(
      this.repo.create({
        scope,
        payload_hash,
        summary,
        requested_by: actorId,
        status: 'PENDING',
        expires_at: new Date(Date.now() + APPROVAL_TTL_MS),
      }),
    );
    await this.audit.record({
      action: AuditAction.PLATFORM_APPROVAL_REQUESTED,
      entity_type: 'PlatformAdmin', // no PlatformApproval audit type exists in shared yet
      entity_id: actorId,
      tenant_id: null,
      performed_by_user_id: actorId,
      new_values: { approval_id: row.id, scope, summary },
    });
    await this.notifyOtherOwners(actorId, summary);
    return { id: row.id };
  }

  private async notifyOtherOwners(
    actorId: string,
    summary: Record<string, unknown>,
  ): Promise<void> {
    const detail = Object.values(summary)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .join(' ')
      .slice(0, 120);
    const others = (await this.owners.listOwners()).filter(
      (o) => o.user_id !== actorId && o.status === UserStatus.ACTIVE,
    );
    for (const o of others) {
      for (const [medium, to] of [
        [CommunicationMedium.SMS, o.phone],
        [CommunicationMedium.EMAIL, o.email],
      ] as const) {
        if (!to) continue;
        await this.delivery
          .deliver({
            tenantId: null,
            medium,
            to,
            recipientName: 'Owner',
            kind: 'PLATFORM_APPROVAL_REQUEST',
            vars: { detail },
          })
          .catch(() => this.logger.warn('approval notice not delivered'));
      }
    }
  }

  async list(status?: PlatformApprovalStatus, limit = 50): Promise<PlatformApprovalRow[]> {
    await this.expireStale();
    const rows = await this.repo.find({
      where: status ? { status } : {},
      order: { created_at: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      summary: r.summary,
      status: r.status,
      requested_by: r.requested_by,
      decided_by: r.decided_by,
      decided_at: r.decided_at,
      expires_at: r.expires_at,
      created_at: r.created_at,
    }));
  }

  /** Another active owner approves or denies. One conditional UPDATE from PENDING. */
  async decide(id: string, approverId: string, decision: 'approve' | 'deny'): Promise<void> {
    const next = decision === 'approve' ? 'GRANTED' : 'DENIED';
    // The approver's status is read under the owner-row share lock and the UPDATE commits in the
    // same transaction, so an owner lock either lands first (refused) or waits for this decision.
    const row = await this.ds.transaction(async (em) => {
      if (!(await this.owners.activeOwnerIds(em)).includes(approverId)) return undefined;
      const res = await em.query(
        `UPDATE platform_approvals SET status = $2, decided_by = $3, decided_at = now()
         WHERE id = $1 AND status = 'PENDING' AND requested_by <> $3 AND expires_at > now()
         RETURNING scope, requested_by`,
        [id, next, approverId],
      );
      return (rowsOf(res) as { scope: string; requested_by: string }[])[0];
    });
    if (!row) throw new ConflictException(DECIDE_REFUSED);
    await this.audit.record({
      action:
        decision === 'approve'
          ? AuditAction.PLATFORM_APPROVAL_GRANTED
          : AuditAction.PLATFORM_APPROVAL_DENIED,
      entity_type: 'PlatformAdmin',
      entity_id: approverId,
      tenant_id: null,
      performed_by_user_id: approverId,
      new_values: { approval_id: id, scope: row.scope, requested_by: row.requested_by },
    });
  }

  /** Claims a GRANTED row once, for the same requester and the same payload. */
  async consume(id: string, actorId: string, payloadHash: string): Promise<boolean> {
    const res = await this.ds.query(
      `UPDATE platform_approvals SET status = 'USED', used_at = now()
       WHERE id = $1 AND status = 'GRANTED' AND requested_by = $2 AND payload_hash = $3
         AND expires_at > now()
       RETURNING id`,
      [id, actorId, payloadHash],
    );
    return rowsOf(res).length === 1;
  }
}
