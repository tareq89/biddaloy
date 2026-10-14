import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
import {
  AuditAction,
  AuthTokenPurpose,
  EMPLOYEE_ROLES,
  SchoolStatus,
  UserRole,
} from '@biddaloy/shared';
import { StaffProfilesService } from '../staff-profiles/staff-profiles.service';
import { generateSecret, hashSecret } from '../auth/token-hash.util';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { reviveMembership } from '../users/users.service';
import { Guardian } from '../students/entities/guardian.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { School } from '../schools/entities/school.entity';
import type { RequestContext } from '../../common/request-context.util';
import { AuthToken } from './entities/auth-token.entity';
import { AuthTokenService, INVITE_TTL_MS } from './auth-token.service';
import { SchoolInviteDto } from './dto/school-invite.dto';

/** What a join request carries in `auth_tokens.metadata`. */
interface JoinRequestMetadata {
  role: UserRole;
  guardian_id?: string | null;
  provisioned?: boolean;
}

/**
 * `guardians (tenant_id, user_id)` is UNIQUE per school among live rows, so an
 * account already linked to another live guardian row of this school can never
 * be linked to this one. A soft-deleted guardian (child left) does not block,
 * same as the index; workbook restore prefers the live row over it. Links in
 * other schools do not count (D11).
 */
export function guardianLinkedElsewhere(
  m: EntityManager,
  userId: string,
  guardianId: string,
  tenantId: string,
): Promise<boolean> {
  return m.exists(Guardian, {
    where: { user_id: userId, tenant_id: tenantId, id: Not(guardianId) },
  });
}

export interface JoinRequestInput {
  userId: string;
  tenantId: string;
  role: UserRole;
  createdByUserId: string | null;
  guardianId?: string;
  provisioned?: boolean;
}

/**
 * Files a pending membership: an `auth_tokens` row (purpose `JOIN_SCHOOL`) in
 * the inviting school. No `user_tenants` row exists until the account owner
 * accepts, so no guard, list or notification can see the person early. A new
 * request for the same (user, school, role) revokes the older live one;
 * other roles and other schools are left alone. The raw secret is never sent: the owner
 * accepts while signed in.
 */
export async function insertJoinRequest(
  m: EntityManager,
  input: JoinRequestInput,
): Promise<AuthToken> {
  // Same lock as `AuthTokenService.issue`, so concurrent requests cannot both stay live.
  await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${input.userId}:${AuthTokenPurpose.JOIN_SCHOOL}`,
  ]);
  await m
    .createQueryBuilder()
    .update(AuthToken)
    .set({ revoked_at: new Date() })
    .where('user_id = :userId AND tenant_id = :tenantId AND purpose = :purpose', {
      userId: input.userId,
      tenantId: input.tenantId,
      purpose: AuthTokenPurpose.JOIN_SCHOOL,
    })
    .andWhere('consumed_at IS NULL AND revoked_at IS NULL')
    // Same role only: provisioning (ADMIN), guardian batch (PARENT) and restore
    // file requests independently, and one must not cancel another's.
    .andWhere(`metadata->>'role' = :role`, { role: input.role })
    .execute();

  const metadata: JoinRequestMetadata = {
    role: input.role,
    guardian_id: input.guardianId ?? null,
    provisioned: input.provisioned ?? false,
  };
  const repo = m.getRepository(AuthToken);
  const row = await repo.save(
    repo.create({
      user_id: input.userId,
      tenant_id: input.tenantId,
      purpose: AuthTokenPurpose.JOIN_SCHOOL,
      token_hash: hashSecret(generateSecret()),
      expires_at: new Date(Date.now() + INVITE_TTL_MS),
      consumed_at: null,
      revoked_at: null,
      created_by_user_id: input.createdByUserId,
      metadata: { ...metadata },
    }),
  );

  const audit = m.getRepository(AuditLog);
  await audit.save(
    audit.create({
      action: AuditAction.CREATE,
      entity_type: 'Membership', // ponytail: no 'SchoolInvite' in the shared audit union; add one if audit filtering needs it
      entity_id: input.userId,
      tenant_id: input.tenantId,
      performed_by_user_id: input.createdByUserId,
      new_values: { via: 'join_request', requested: true, request_id: row.id, role: input.role },
    }),
  );
  return row;
}

@Injectable()
export class SchoolInviteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authTokens: AuthTokenService,
    private readonly audit: AuditService,
    private readonly staffProfiles: StaffProfilesService,
  ) {}

  /** The caller's own live requests, with the school's name. */
  async listMine(userId: string): Promise<SchoolInviteDto[]> {
    const rows: {
      id: string;
      school_id: string;
      school_name: string;
      role: UserRole;
      expires_at: Date;
    }[] = await this.dataSource
      .getRepository(AuthToken)
      .createQueryBuilder('t')
      .innerJoin(
        'schools',
        's',
        's.id = t.tenant_id AND s.deleted_at IS NULL AND s.status = :active',
        {
          active: SchoolStatus.ACTIVE,
        },
      )
      .select([
        't.id AS id',
        't.tenant_id AS school_id',
        's.name AS school_name',
        `t.metadata->>'role' AS role`,
        't.expires_at AS expires_at',
      ])
      .where('t.user_id = :userId AND t.purpose = :purpose', {
        userId,
        purpose: AuthTokenPurpose.JOIN_SCHOOL,
      })
      .andWhere('t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > NOW()')
      .orderBy('t.created_at', 'DESC')
      .getRawMany();
    return rows;
  }

  /** Loads the caller's own live request `FOR UPDATE`; 404 if it is not theirs or not live. */
  private async lockLive(m: EntityManager, userId: string, id: string): Promise<AuthToken> {
    const row = await m
      .getRepository(AuthToken)
      .createQueryBuilder('t')
      .setLock('pessimistic_write')
      .where('t.id = :id AND t.user_id = :userId AND t.purpose = :purpose', {
        id,
        userId,
        purpose: AuthTokenPurpose.JOIN_SCHOOL,
      })
      .getOne();
    if (!row || row.consumed_at || row.revoked_at || row.expires_at.getTime() <= Date.now()) {
      throw new NotFoundException('School invite not found');
    }
    return row;
  }

  /**
   * Accepting makes the caller a member with the requested role. A request
   * that carries a guardian must also link that guardian; if it no longer can
   * (the guardian was removed, linked to someone else, or the caller is linked
   * to another guardian, see `guardianLinkedElsewhere`), a PARENT membership
   * would show no children, so the request is retired and the caller gets a 409.
   */
  async accept(userId: string, id: string, context: RequestContext): Promise<void> {
    const outcome = await this.dataSource.transaction(async (m) => {
      const row = await this.lockLive(m, userId, id);
      const meta = row.metadata as unknown as JoinRequestMetadata;
      const tenantId = row.tenant_id as string;

      // A deleted or suspended school is answered like a missing request.
      if (!(await m.exists(School, { where: { id: tenantId, status: SchoolStatus.ACTIVE } }))) {
        throw new NotFoundException('School invite not found');
      }

      if (meta.guardian_id) {
        const linked =
          !(await guardianLinkedElsewhere(m, userId, meta.guardian_id, tenantId)) &&
          ((
            await m
              .createQueryBuilder()
              .update(Guardian)
              .set({ user_id: userId })
              .where('id = :guardianId AND tenant_id = :tenantId AND deleted_at IS NULL', {
                guardianId: meta.guardian_id,
                tenantId,
              })
              .andWhere('(user_id IS NULL OR user_id = :userId)', { userId })
              .execute()
          ).affected ?? 0) > 0;
        if (!linked) {
          await m.getRepository(AuthToken).update({ id: row.id }, { revoked_at: new Date() });
          await this.audit.record(
            {
              action: AuditAction.INVITATION_REVOKED,
              entity_type: 'Membership',
              entity_id: userId,
              tenant_id: tenantId,
              performed_by_user_id: userId,
              ip_address: context.ip,
              user_agent: context.userAgent,
              new_values: {
                via: 'join_request',
                request_id: row.id,
                reason: 'guardian_unlinkable',
              },
            },
            m,
          );
          return 'unlinkable' as const;
        }
      }

      // Per role: someone who is already, say, a TEACHER here still needs the PARENT row.
      const ut = m.getRepository(UserTenant);
      const live = await ut.exists({
        where: { user_id: userId, tenant_id: tenantId, role: meta.role },
      });
      if (!live) {
        const former = await ut.findOne({
          where: { user_id: userId, tenant_id: tenantId, role: meta.role },
          withDeleted: true,
        });
        if (former) {
          await reviveMembership(m, former.id);
        } else {
          await ut.save(
            ut.create({
              user_id: userId,
              tenant_id: tenantId,
              role: meta.role,
              metadata: meta.provisioned ? { provisioned: true } : null,
            }),
          );
        }
      }

      // [68.2.02] Same rule as `UserService.create`: a non-teacher employee role
      // gets its generic staff profile for THIS school (profiles are per school).
      if (
        meta.role !== UserRole.TEACHER &&
        EMPLOYEE_ROLES.includes(meta.role) &&
        !(await m.exists(StaffProfile, { where: { user_id: userId, tenant_id: tenantId } }))
      ) {
        await this.staffProfiles.createFor(userId, tenantId, {}, m);
      }

      await this.authTokens.consume(row.id, m);
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'Membership',
          entity_id: userId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { via: 'join_request', request_id: row.id, role: meta.role },
        },
        m,
      );
      return 'joined' as const;
    });
    if (outcome === 'unlinkable') {
      throw new ConflictException('This invite can no longer be accepted');
    }
  }

  async decline(userId: string, id: string, context: RequestContext): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const row = await this.lockLive(m, userId, id);
      await m.getRepository(AuthToken).update({ id: row.id }, { revoked_at: new Date() });
      await this.audit.record(
        {
          action: AuditAction.INVITATION_REVOKED,
          entity_type: 'Membership',
          entity_id: userId,
          tenant_id: row.tenant_id,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { via: 'join_request', request_id: row.id, declined: true },
        },
        m,
      );
    });
  }
}
