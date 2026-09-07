import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import Redis from 'ioredis';
import { AuditAction, AuthTokenPurpose, SchoolStatus, UserRole } from '@biddaloy/shared';
import { School } from '../entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { AuthToken } from '../../account-access/entities/auth-token.entity';
import { INVITE_TTL_MS } from '../../account-access/auth-token.service';
import {
  AccountAccessDeliveryService,
  pickChannel,
} from '../../account-access/account-access-delivery.service';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';
import { generateSecret, hashSecret } from '../../auth/token-hash.util';
import { AuditService } from '../../audit/audit.service';
import { TENANT_STATUS_REDIS } from '../tenant-status.service';
import { ProvisionSchoolDto } from './dto/provision-school.dto';

const IDEMPOTENCY_TTL_SECONDS = 86_400;

export interface ProvisionResult {
  school: { id: string; slug: string; status: SchoolStatus };
  admin: { user_id: string; existed: boolean };
  invitation: { id: string; status: string };
}

export interface AdminInput {
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface ProvisionAdminResult {
  admin: { user_id: string; existed: boolean };
  invitation: { id: string; status: string };
}

function idempotencyKey(key: string): string {
  return `provision:${key}`;
}

/**
 * `POST /schools` (#529): SUPER_ADMIN creates a school and its first
 * ADMIN in one transaction. Idempotent via a client-supplied UUID stored
 * in Redis (`SET provision:<key> ... NX EX 86400`) — a retried request
 * (network blip, double-click) replays the original result instead of
 * creating a second school/user/invitation.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly audit: AuditService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly config: ConfigService,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
  ) {}

  async provision(
    dto: ProvisionSchoolDto,
    actorUserId: string,
  ): Promise<{ result: ProvisionResult; replayed: boolean }> {
    const key = idempotencyKey(dto.idempotency_key);

    const cached = await this.redis.get(key);
    if (cached) {
      return { result: JSON.parse(cached) as ProvisionResult, replayed: true };
    }

    let deliverAfterCommit: (() => Promise<void>) | null = null;

    let result: ProvisionResult;
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const schoolRepo = manager.getRepository(School);

        const school = await schoolRepo.save(
          schoolRepo.create({
            name: dto.name,
            slug: dto.slug,
            status: SchoolStatus.ACTIVE,
          }),
        );

        const admin = await this.provisionAdminForSchool(
          school.id,
          dto.admin,
          actorUserId,
          manager,
        );

        await this.audit.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'School',
            entity_id: school.id,
            tenant_id: school.id,
            performed_by_user_id: actorUserId,
            new_values: { admin_user_id: admin.result.admin.user_id },
          },
          manager,
        );

        // Delivery is dispatched only after this transaction commits (see
        // below) — a rolled-back transaction must never have sent a real
        // message.
        deliverAfterCommit = admin.deliverAfterCommit;

        return {
          school: { id: school.id, slug: school.slug, status: school.status as SchoolStatus },
          admin: admin.result.admin,
          invitation: admin.result.invitation,
        };
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(`School with slug "${dto.slug}" already exists`);
      }
      throw err;
    }

    if (deliverAfterCommit) {
      try {
        await deliverAfterCommit();
      } catch (error) {
        // A delivery failure must not undo the already-committed
        // school/user/invitation — matches AccountAccessDeliveryService's
        // own fail-open-into-a-FAILED-log behavior.
        this.logger.error(
          `Invitation delivery failed for school ${result.school.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    try {
      await this.redis.set(key, JSON.stringify(result), 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    } catch (error) {
      this.logger.error(
        `Idempotency store failed for provision key ${dto.idempotency_key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { result, replayed: false };
  }

  /**
   * Shared by `provision()` (`POST /schools`, #529) and
   * `SchoolAdminsService.addAdmin` (`POST /schools/:id/admins`, #531): find
   * or create the admin user, attach an ADMIN membership on `schoolId`, and
   * issue an invitation — all within the caller's transaction (`manager`).
   * Delivery is deferred to a returned closure so the caller can invoke it
   * only after its own transaction commits, matching `provision()`'s
   * existing fail-closed-on-rollback / fail-open-on-delivery-error behavior.
   */
  async provisionAdminForSchool(
    schoolId: string,
    admin: AdminInput,
    actorUserId: string,
    manager: EntityManager,
  ): Promise<{
    result: ProvisionAdminResult;
    deliverAfterCommit: (() => Promise<void>) | null;
  }> {
    const userRepo = manager.getRepository(User);
    const userTenantRepo = manager.getRepository(UserTenant);
    const authTokenRepo = manager.getRepository(AuthToken);

    const { user, existed } = await this.findOrCreateAdminUser(userRepo, admin);

    await userTenantRepo.save(
      userTenantRepo.create({
        user_id: user.id,
        tenant_id: schoolId,
        role: UserRole.ADMIN,
      }),
    );

    const raw = generateSecret();
    const invite = await authTokenRepo.save(
      authTokenRepo.create({
        user_id: user.id,
        tenant_id: schoolId,
        purpose: AuthTokenPurpose.INVITE,
        token_hash: hashSecret(raw),
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
        consumed_at: null,
        revoked_at: null,
        created_by_user_id: actorUserId,
        metadata: null,
      }),
    );

    // No dedicated "invitation delivery" BullMQ queue exists in
    // account-access today (the only queue, INVITATION_BATCH_QUEUE, is
    // guardian-batch-specific and looks the job up by guardianId, which
    // doesn't apply here) — `AccountAccessDeliveryService.deliver` is the
    // existing send path `InvitationService.issueAndSend` itself calls
    // synchronously, so this reuses that same call, just deferred to after
    // commit.
    let deliverAfterCommit: (() => Promise<void>) | null = null;
    const channel = pickChannel(user);
    if (channel) {
      const link = `${resolveAppBaseUrl(this.config)}/activate?token=${raw}`;
      deliverAfterCommit = async () => {
        await this.delivery.deliver({
          tenantId: schoolId,
          medium: channel.medium,
          to: channel.to,
          recipientName: user.full_name,
          kind: 'INVITATION',
          vars: { link },
        });
      };
    }

    return {
      result: {
        admin: { user_id: user.id, existed },
        invitation: { id: invite.id, status: 'PENDING' },
      },
      deliverAfterCommit,
    };
  }

  private async findOrCreateAdminUser(
    userRepo: Repository<User>,
    admin: AdminInput,
  ): Promise<{ user: User; existed: boolean }> {
    if (admin.email || admin.phone) {
      const found = await userRepo
        .createQueryBuilder('u')
        .where('u.deleted_at IS NULL')
        .andWhere('(u.email = :email OR u.phone = :phone)', {
          email: admin.email ?? '__none__',
          phone: admin.phone ?? '__none__',
        })
        .getOne();
      if (found) {
        return { user: found, existed: true };
      }
    }

    const created = await userRepo.save(
      userRepo.create({
        email: admin.email ?? null,
        phone: admin.phone ?? null,
        password_hash: null,
        full_name: admin.name,
      }),
    );
    return { user: created, existed: false };
  }
}
