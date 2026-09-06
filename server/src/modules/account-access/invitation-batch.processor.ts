import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuthTokenPurpose, UserRole } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuthTokenService } from './auth-token.service';
import { InvitationService } from './invitation.service';
import { INVITATION_BATCH_QUEUE } from './invitation-batch.constants';
import type { InvitationBatchJobData } from './guardian-provisioning.service';

/**
 * Fans out `GuardianProvisioningService.dispatch`'s queued jobs — one
 * per guardian: ensure a `User` (+ tenant membership) exists, then issue and
 * send an invitation tagged with the batch id. Copies
 * `RefreshTokenCleanupProcessor`'s shape (12.6).
 */
@Processor(INVITATION_BATCH_QUEUE, { concurrency: 2 })
export class InvitationBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(InvitationBatchProcessor.name);

  constructor(
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly dataSource: DataSource,
    private readonly authTokens: AuthTokenService,
    private readonly invitationService: InvitationService,
  ) {
    super();
  }

  async process(job: Job<InvitationBatchJobData>): Promise<void> {
    const { tenantId, guardianId, actorUserId, batchId } = job.data;

    const guardian = await this.guardianRepo.findOne({
      where: { id: guardianId, tenant_id: tenantId },
    });
    if (!guardian) {
      this.logger.warn(`Guardian ${guardianId} not found for batch ${batchId}, skipping`);
      return;
    }

    // Re-checked here, not trusted from the preview that queued this job —
    // the guardian may have opted out between preview and processing.
    if (guardian.notifications_enabled === false) {
      this.logger.log(`Guardian ${guardianId} opted out since preview, skipping batch ${batchId}`);
      return;
    }

    const user = await this.ensureUser(guardian, tenantId);

    if (user.password_hash) {
      // Activated between preview and processing — nothing to send.
      return;
    }

    // Idempotent: a retry after a transient delivery failure must not
    // re-issue a token if this same batch already produced a live one.
    const latest = await this.authTokens.latest(user.id, AuthTokenPurpose.INVITE, tenantId);
    if (
      latest &&
      !latest.consumed_at &&
      !latest.revoked_at &&
      latest.expires_at > new Date() &&
      (latest.metadata as { batch_id?: string } | null)?.batch_id === batchId
    ) {
      return;
    }

    await this.invitationService.issueAndSend({
      userId: user.id,
      tenantId,
      actorUserId,
      metadata: { batch_id: batchId },
    });
  }

  /**
   * Loads the guardian's linked user, or finds one by phone/email, or
   * creates a new passwordless PARENT user + tenant membership — all inside
   * one transaction. A `23505` (unique violation) race with a concurrent
   * creator is treated as "found" and retried once.
   */
  private async ensureUser(guardian: Guardian, tenantId: string): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const userTenantRepo = manager.getRepository(UserTenant);
      const guardianRepo = manager.getRepository(Guardian);

      const attempt = async (): Promise<User> => {
        if (guardian.user_id) {
          const existing = await userRepo.findOne({ where: { id: guardian.user_id } });
          if (existing) return existing;
        }

        const found = await userRepo
          .createQueryBuilder('u')
          .where('u.deleted_at IS NULL')
          .andWhere('(u.email = :email OR u.phone = :phone)', {
            email: guardian.email ?? '__none__',
            phone: guardian.phone ?? '__none__',
          })
          .getOne();
        if (found) return found;

        const created = userRepo.create({
          email: guardian.email ?? null,
          phone: guardian.phone ?? null,
          password_hash: null,
          full_name: guardian.full_name,
        });
        return userRepo.save(created);
      };

      let user: User;
      try {
        user = await attempt();
      } catch (err) {
        if (
          err instanceof QueryFailedError &&
          (err as unknown as { code?: string }).code === '23505'
        ) {
          user = await attempt();
        } else {
          throw err;
        }
      }

      if (!guardian.user_id || guardian.user_id !== user.id) {
        await guardianRepo.update({ id: guardian.id }, { user_id: user.id });
      }

      const membership = await userTenantRepo.findOne({
        where: { user_id: user.id, tenant_id: tenantId },
      });
      if (!membership) {
        await userTenantRepo.save(
          userTenantRepo.create({ user_id: user.id, tenant_id: tenantId, role: UserRole.PARENT }),
        );
      }

      return user;
    });
  }
}
