import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AuditAction, AuthTokenPurpose, CommunicationStatus } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { AuthTokenService } from './auth-token.service';
import { pickChannel } from './account-access-delivery.service';
import { INVITATION_BATCH_QUEUE, MAX_BATCH_INVITE_SELECTION } from './invitation-batch.constants';
import type {
  InviteBatchStatusResponseDto,
  InviteDispatchResponseDto,
  InvitePreviewResponseDto,
  InviteSkipReason,
  InviteSkippedEntryDto,
} from './dto/batch-invite.dto';

export interface BatchInviteSelection {
  guardian_ids?: string[];
  student_ids?: string[];
  all?: boolean;
}

export interface InvitationBatchJobData {
  tenantId: string;
  guardianId: string;
  actorUserId: string;
  batchId: string;
}

/**
 * Preview-first batch provisioning of passwordless `PARENT` accounts for
 * guardians (12.6). Batch identity is a `batch_id` UUID written into
 * `communication_logs.metadata.batch_id` / `auth_tokens.metadata.batch_id`
 * — not a `ReminderBatch`-shaped entity — per the plan's corrections.
 */
@Injectable()
export class GuardianProvisioningService {
  constructor(
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly authTokens: AuthTokenService,
    private readonly audit: AuditService,
    @InjectQueue(INVITATION_BATCH_QUEUE)
    private readonly queue: Queue<InvitationBatchJobData>,
  ) {}

  private async resolveGuardians(
    tenantId: string,
    selection: BatchInviteSelection,
  ): Promise<Guardian[]> {
    const selectors = [selection.guardian_ids, selection.student_ids, selection.all].filter(
      (s) => s !== undefined && s !== null && s !== false,
    );
    if (selectors.length !== 1) {
      throw new BadRequestException(
        'Exactly one of guardian_ids, student_ids, all must be supplied',
      );
    }

    const qb = this.guardianRepo
      .createQueryBuilder('guardian')
      .where('guardian.tenant_id = :tenantId', { tenantId })
      .andWhere('guardian.deleted_at IS NULL');

    if (selection.guardian_ids) {
      if (selection.guardian_ids.length === 0) return [];
      qb.andWhere('guardian.id IN (:...guardianIds)', { guardianIds: selection.guardian_ids });
    } else if (selection.student_ids) {
      if (selection.student_ids.length === 0) return [];
      qb.innerJoin('student_guardians', 'sg', 'sg.guardian_id = guardian.id').andWhere(
        'sg.student_id IN (:...studentIds)',
        { studentIds: selection.student_ids },
      );
    }
    // `all` needs no extra predicate — tenant scope above already narrows it.

    // Cross-tenant ids in the selection are simply excluded by the
    // tenant_id predicate above, never a 500. `take` caps the row count the
    // query itself returns so an oversized `all` selection can't force a
    // full-table materialization before the size check below rejects it.
    const guardians = await qb
      .distinct(true)
      .take(MAX_BATCH_INVITE_SELECTION + 1)
      .getMany();
    if (guardians.length > MAX_BATCH_INVITE_SELECTION) {
      throw new BadRequestException(
        `A batch cannot exceed ${MAX_BATCH_INVITE_SELECTION} guardians`,
      );
    }
    return guardians;
  }

  /** Resolves whether a guardian is linked to an existing account and its lifecycle state. */
  private async classify(
    guardian: Guardian,
    tenantId: string,
  ): Promise<
    | { kind: 'skip'; reason: InviteSkipReason }
    | { kind: 'invite'; user: User | null; channel: 'SMS' | 'EMAIL' }
  > {
    if (guardian.notifications_enabled === false) {
      return { kind: 'skip', reason: 'notifications_disabled' };
    }

    const channel = pickChannel(guardian);
    if (!channel) {
      return { kind: 'skip', reason: 'no_contact' };
    }

    let user: User | null = null;
    if (guardian.user_id) {
      user = await this.userRepo.findOne({ where: { id: guardian.user_id } });
    } else {
      user = await this.userRepo
        .createQueryBuilder('u')
        .where('u.deleted_at IS NULL')
        .andWhere('(u.email = :email OR u.phone = :phone)', {
          email: guardian.email ?? '__none__',
          phone: guardian.phone ?? '__none__',
        })
        .getOne();
    }

    if (user?.password_hash) {
      return { kind: 'skip', reason: 'already_active' };
    }

    if (user) {
      const latest = await this.authTokens.latest(user.id, AuthTokenPurpose.INVITE, tenantId);
      if (latest && !latest.consumed_at && !latest.revoked_at && latest.expires_at > new Date()) {
        return { kind: 'skip', reason: 'already_pending' };
      }
    }

    return { kind: 'invite', user, channel: channel.medium };
  }

  async preview(
    tenantId: string,
    selection: BatchInviteSelection,
  ): Promise<InvitePreviewResponseDto> {
    const guardians = await this.resolveGuardians(tenantId, selection);

    const to_invite: InvitePreviewResponseDto['to_invite'] = [];
    const skipped: InviteSkippedEntryDto[] = [];

    for (const guardian of guardians) {
      const result = await this.classify(guardian, tenantId);
      if (result.kind === 'skip') {
        skipped.push({
          guardian_id: guardian.id,
          full_name: guardian.full_name,
          reason: result.reason,
        });
      } else {
        to_invite.push({
          guardian_id: guardian.id,
          full_name: guardian.full_name,
          channel: result.channel,
          user_exists: result.user != null,
        });
      }
    }

    return { total: guardians.length, to_invite, skipped };
  }

  async dispatch(input: {
    tenantId: string;
    actorUserId: string;
    selection: BatchInviteSelection;
  }): Promise<InviteDispatchResponseDto> {
    const { to_invite, skipped } = await this.preview(input.tenantId, input.selection);
    const batchId = randomUUID();

    for (const entry of to_invite) {
      await this.queue.add(
        'invite-guardian',
        {
          tenantId: input.tenantId,
          guardianId: entry.guardian_id,
          actorUserId: input.actorUserId,
          batchId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    }

    await this.audit.record({
      action: AuditAction.INVITATION_SENT,
      entity_type: 'InvitationBatch',
      entity_id: batchId,
      tenant_id: input.tenantId,
      performed_by_user_id: input.actorUserId,
      new_values: { batch_id: batchId, queued: to_invite.length, skipped: skipped.length },
    });

    return { batch_id: batchId, queued: to_invite.length, skipped };
  }

  async batchStatus(tenantId: string, batchId: string): Promise<InviteBatchStatusResponseDto> {
    const auditRow = await this.auditLogRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.entity_type = :entityType', { entityType: 'InvitationBatch' })
      .andWhere("a.new_values->>'batch_id' = :batchId", { batchId })
      .getOne();

    const total = (auditRow?.new_values?.queued as number | undefined) ?? 0;

    const rows = await this.logRepo
      .createQueryBuilder('log')
      .select('log.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('log.tenant_id = :tenantId', { tenantId })
      .andWhere("log.metadata->>'batch_id' = :batchId", { batchId })
      .groupBy('log.status')
      .getRawMany<{ status: CommunicationStatus; count: string }>();

    const byStatus = new Map(rows.map((r) => [r.status, Number(r.count)]));
    const sent = byStatus.get(CommunicationStatus.SENT) ?? 0;
    const failed = byStatus.get(CommunicationStatus.FAILED) ?? 0;
    const queued = Math.max(total - sent - failed, 0);

    return { batch_id: batchId, total, sent, failed, queued };
  }
}
