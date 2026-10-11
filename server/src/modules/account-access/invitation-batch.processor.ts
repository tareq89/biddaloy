import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DelayedError, type Job } from 'bullmq';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuthTokenPurpose, UserRole } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { reviveMembership } from '../users/users.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { AuthTokenService } from './auth-token.service';
import { guardianLinkedElsewhere, insertJoinRequest } from './school-invite.service';
import { InvitationService } from './invitation.service';
import { INVITATION_BATCH_QUEUE } from './invitation-batch.constants';
import type { InvitationBatchJobData } from './guardian-provisioning.service';

/** How long a guardian's invite waits before re-checking a running restore. */
export const INVITATION_RESTORE_RETRY_MS = 60_000;

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
    private readonly tenantStatus: TenantStatusService,
  ) {
    super();
  }

  async process(job: Job<InvitationBatchJobData>, token?: string): Promise<void> {
    const { tenantId, guardianId, actorUserId, batchId } = job.data;

    // [68.1.fix] A restore is rewriting this school's `users`/`guardians`/`user_tenants` (#2210):
    // a write now would be lost or mixed into the restored data. Park the job and re-check later;
    // `DelayedError` tells BullMQ this is not a failure, so no retry attempt is spent.
    if (await this.tenantStatus.isRestoring(tenantId)) {
      await job.moveToDelayed(Date.now() + INVITATION_RESTORE_RETRY_MS, token);
      throw new DelayedError();
    }

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

    const user = await this.ensureUser(guardian, tenantId, actorUserId);
    // A join request was filed (the owner of an existing account decides) or
    // the contact belongs to an unverified holder: nothing to send.
    if (!user) return;

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
   * Loads the guardian's linked user, or finds one by a VERIFIED email/phone,
   * or creates a new passwordless PARENT user + tenant membership — all
   * inside one transaction. Returns `null` when nothing should be sent:
   *  - an account that never had a row here only gets a join request (the
   *    owner accepts it; we never attach an account on their behalf). That
   *    includes a `guardian.user_id` this school never vetted, e.g. one a
   *    restored workbook set;
   *  - the account is linked to another guardian (`guardianLinkedElsewhere`);
   *  - an unverified holder already owns the guardian's email/phone.
   * An unverified `users.email`/`phone` is never trusted as proof of identity.
   */
  private async ensureUser(
    guardian: Guardian,
    tenantId: string,
    actorUserId: string | null,
  ): Promise<User | null> {
    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const userTenantRepo = manager.getRepository(UserTenant);
      const guardianRepo = manager.getRepository(Guardian);

      let user: User | null = guardian.user_id
        ? await userRepo.findOne({ where: { id: guardian.user_id } })
        : null;

      user ??= await userRepo
        .createQueryBuilder('u')
        .where('u.deleted_at IS NULL')
        .andWhere(
          '((u.email = :email AND u.email_verified_at IS NOT NULL) OR (u.phone = :phone AND u.phone_verified_at IS NOT NULL))',
          { email: guardian.email ?? '__none__', phone: guardian.phone ?? '__none__' },
        )
        .getOne();

      if (user) {
        if (await guardianLinkedElsewhere(manager, user.id, guardian.id)) {
          this.logger.warn(
            `Guardian ${guardian.id}: the matched account is linked to another guardian, not linked`,
          );
          return null;
        }
        const anyRow = await userTenantRepo.findOne({
          where: { user_id: user.id, tenant_id: tenantId },
          withDeleted: true,
        });
        if (!anyRow) {
          await insertJoinRequest(manager, {
            userId: user.id,
            tenantId,
            role: UserRole.PARENT,
            guardianId: guardian.id,
            createdByUserId: actorUserId,
          });
          return null;
        }
      }

      if (!user) {
        try {
          // Nested transaction = savepoint, so a 23505 does not poison the outer one.
          user = await manager.transaction((sp) => {
            const repo = sp.getRepository(User);
            return repo.save(
              repo.create({
                email: guardian.email ?? null,
                phone: guardian.phone ?? null,
                password_hash: null,
                full_name: guardian.full_name,
              }),
            );
          });
        } catch (err) {
          if (
            err instanceof QueryFailedError &&
            (err as unknown as { code?: string }).code === '23505'
          ) {
            // An unverified holder owns this contact. Never fall back to matching them.
            this.logger.warn(
              `Guardian ${guardian.id}: email/phone already held by an unverified account, not linked`,
            );
            return null;
          }
          throw err;
        }
      }

      if (guardian.user_id !== user.id) {
        await guardianRepo.update({ id: guardian.id }, { user_id: user.id });
      }

      // PARENT specifically: a TEACHER here linked as a guardian still needs it for family access.
      const membership = await userTenantRepo.findOne({
        where: { user_id: user.id, tenant_id: tenantId, role: UserRole.PARENT },
      });
      if (!membership) {
        // The unique index ignores soft-deletion, so a guardian who was
        // removed earlier is restored rather than re-inserted (23505).
        const former = await userTenantRepo.findOne({
          where: { user_id: user.id, tenant_id: tenantId, role: UserRole.PARENT },
          withDeleted: true,
        });
        if (former) {
          await reviveMembership(manager, former.id);
        } else {
          await userTenantRepo.save(
            userTenantRepo.create({ user_id: user.id, tenant_id: tenantId, role: UserRole.PARENT }),
          );
        }
      }

      return user;
    });
  }
}
