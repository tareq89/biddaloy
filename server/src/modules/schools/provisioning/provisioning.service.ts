import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
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

/** Prefix of the value stored under the idempotency key while the first
 * request for that key is still inside its transaction — followed by a
 * per-request owner token, so every release/renew/finalize below can prove
 * it still holds the reservation before touching the key. Lets a
 * concurrent duplicate tell "someone is already doing this" apart from
 * "nothing stored yet". */
const IN_PROGRESS_PREFIX = '__provisioning__:';
/** How long the reservation lives if the reserving process dies mid-flight
 * without clearing it — after this a retry gets a fresh attempt instead of
 * being stuck behind a ghost. A live reserver renews it (see
 * `RESERVATION_RENEW_MS`), so this only ever expires for a dead one. */
const RESERVATION_TTL_SECONDS = 60;
/** Renewal cadence for a live reservation — well inside the TTL, so a
 * transaction that outlives 60s (slow DB, lock wait) keeps its lease
 * instead of letting a retry take over and provision a second school. */
const RESERVATION_RENEW_MS = 20_000;

/** Owner-checked Redis scripts. Each compares the stored value to this
 * request's owner token *atomically* before acting, so a request whose
 * lease was lost (process paused past the TTL, key taken over by a retry)
 * can neither delete the successor's reservation nor overwrite its result. */
const RELEASE_IF_OWNER = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end
return 0`;
const RENEW_IF_OWNER = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) end
return 0`;
const FINALIZE_IF_OWNER = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]) end
return nil`;
/** A duplicate that arrives while the first is in flight polls for the
 * stored result rather than failing straight away — a double-click is
 * typically milliseconds behind, so this almost always resolves. */
const IN_PROGRESS_POLL_MS = 100;
const IN_PROGRESS_POLL_ATTEMPTS = 50;

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

    // Reserve the key atomically *before* any work. A plain GET-then-work
    // race lets two concurrent requests with the same key both miss the
    // cache and both create a school; `SET NX` guarantees exactly one of
    // them wins the reservation and the other waits for its result.
    const owner = `${IN_PROGRESS_PREFIX}${randomUUID()}`;
    const reserved = await this.redis.set(key, owner, 'EX', RESERVATION_TTL_SECONDS, 'NX');
    if (reserved !== 'OK') {
      return { result: await this.awaitStoredResult(key, dto.idempotency_key), replayed: true };
    }

    // Keep the lease alive for as long as this request is actually working
    // — owner-checked, so it never extends a reservation that has since
    // passed to someone else. `unref` so a renewal timer can't hold the
    // process open on shutdown.
    const renewal = setInterval(() => {
      void this.redis
        .eval(RENEW_IF_OWNER, 1, key, owner, RESERVATION_TTL_SECONDS)
        .catch(() => undefined);
    }, RESERVATION_RENEW_MS);
    renewal.unref();

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
      clearInterval(renewal);
      // A failed transaction must release the reservation, otherwise a
      // legitimate retry with the same key would be told "in progress"
      // until the reservation TTL expires. Owner-checked: if the lease was
      // already lost to a retry, that retry's reservation stays put.
      await this.redis.eval(RELEASE_IF_OWNER, 1, key, owner).catch((error: unknown) => {
        this.logger.error(
          `Idempotency reservation release failed for provision key ${dto.idempotency_key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      // Only the school insert can still raise a raw unique-violation here —
      // `provisionAdminForSchool` maps the membership one to its own 409.
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(`School with slug "${dto.slug}" already exists`);
      }
      throw err;
    }
    clearInterval(renewal);

    if (deliverAfterCommit) {
      try {
        // Same cast as `SchoolAdminsService.addAdmin` — `deliverAfterCommit`
        // is reassigned inside the `dataSource.transaction` closure above,
        // so TS's control-flow narrowing from the `if` guard above doesn't
        // survive across that function boundary and widens this call to
        // `never`.
        await (deliverAfterCommit as () => Promise<void>)();
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
      // Replaces this request's own in-progress marker with the final
      // result for the full replay window — owner-checked, so a lost lease
      // never overwrites whatever a successor has stored since.
      const stored = await this.redis.eval(
        FINALIZE_IF_OWNER,
        1,
        key,
        owner,
        JSON.stringify(result),
        IDEMPOTENCY_TTL_SECONDS,
      );
      if (stored !== 'OK') {
        this.logger.warn(
          `Idempotency reservation for provision key ${dto.idempotency_key} was lost before completion; result for school ${result.school.id} not stored for replay`,
        );
      }
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
   * The key is already held by another request. Either it finished (stored
   * a result — replay it) or it is still inside its transaction (poll a
   * little, then give up with a 409 the client can simply retry).
   */
  private async awaitStoredResult(key: string, idempotencyKey: string): Promise<ProvisionResult> {
    for (let attempt = 0; attempt < IN_PROGRESS_POLL_ATTEMPTS; attempt += 1) {
      const stored = await this.redis.get(key);
      if (stored === null) {
        // The holder failed and released the key — this request is a
        // legitimate retry now, not a duplicate, but re-entering provision()
        // from here would recurse; a 409 tells the client to retry.
        break;
      }
      if (!stored.startsWith(IN_PROGRESS_PREFIX)) {
        return JSON.parse(stored) as ProvisionResult;
      }
      await new Promise((resolve) => setTimeout(resolve, IN_PROGRESS_POLL_MS));
    }
    throw new ConflictException(
      `Provisioning for idempotency_key "${idempotencyKey}" is still in progress — retry shortly`,
    );
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

    // `(user_id, tenant_id, role)` is unique on user_tenants — saving a
    // second ADMIN membership for the same user would surface as a raw
    // QueryFailedError (500). Check inside the caller's transaction and
    // answer with a defined 409 instead, without issuing another invitation.
    const existingMembership = await userTenantRepo.findOne({
      where: { user_id: user.id, tenant_id: schoolId, role: UserRole.ADMIN },
    });
    if (existingMembership) {
      throw new ConflictException(`User "${user.id}" is already an ADMIN of this school`);
    }

    try {
      await userTenantRepo.save(
        userTenantRepo.create({
          user_id: user.id,
          tenant_id: schoolId,
          role: UserRole.ADMIN,
          // Marks this as the membership `provision()` itself created, so a
          // later "restore from workbook" into this same school (whose
          // `deleteByAbsence` on the `users` tab hard-deletes any UserTenant
          // absent from the imported workbook) never removes the new
          // school's own admin — see `users.tab.ts`'s `remove()`.
          metadata: { provisioned: true },
        }),
      );
    } catch (err) {
      // Two concurrent requests can both pass the pre-check above; the
      // unique index then rejects the second insert. Same 409 as the
      // pre-check, not a raw persistence error.
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(`User "${user.id}" is already an ADMIN of this school`);
      }
      throw err;
    }

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
    // Each contact resolved on its own, not one `email OR phone` query: with
    // both supplied, an OR could match two *different* users and silently
    // grant ADMIN to whichever Postgres returned first. Two hits that
    // disagree are a request that names two people — refuse it.
    const byEmail = admin.email
      ? await userRepo
          .createQueryBuilder('u')
          .where('u.deleted_at IS NULL')
          .andWhere('u.email = :email', { email: admin.email })
          .getOne()
      : null;
    const byPhone = admin.phone
      ? await userRepo
          .createQueryBuilder('u')
          .where('u.deleted_at IS NULL')
          .andWhere('u.phone = :phone', { phone: admin.phone })
          .getOne()
      : null;
    if (byEmail && byPhone && byEmail.id !== byPhone.id) {
      throw new ConflictException(
        'The admin email and phone belong to two different existing users',
      );
    }
    const found = byEmail ?? byPhone;
    if (found) {
      return { user: found, existed: true };
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
