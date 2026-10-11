import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditAction, AuthTokenPurpose, UserRole } from '@biddaloy/shared';
import { generateSecret, hashSecret } from '../auth/token-hash.util';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { reviveMembership } from '../users/users.service';
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
 * request for the same (user, school) revokes the older live one; requests
 * for other schools are left alone. The raw secret is never sent: the owner
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
      entity_id: row.id,
      tenant_id: input.tenantId,
      performed_by_user_id: input.createdByUserId,
      new_values: { via: 'join_request', requested: true, user_id: input.userId, role: input.role },
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
      .innerJoin('schools', 's', 's.id = t.tenant_id')
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

  async accept(userId: string, id: string, context: RequestContext): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const row = await this.lockLive(m, userId, id);
      const meta = row.metadata as unknown as JoinRequestMetadata;
      const tenantId = row.tenant_id as string;
      const ut = m.getRepository(UserTenant);

      const live = await ut.findOne({ where: { user_id: userId, tenant_id: tenantId } });
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

      if (meta.guardian_id) {
        // Only a guardian that is still unlinked, in the inviting school.
        await m.query(
          `UPDATE guardians SET user_id = $1 WHERE id = $2 AND tenant_id = $3 AND user_id IS NULL`,
          [userId, meta.guardian_id, tenantId],
        );
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
          new_values: { via: 'join_request', role: meta.role },
        },
        m,
      );
    });
  }

  async decline(userId: string, id: string, context: RequestContext): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const row = await this.lockLive(m, userId, id);
      await m.getRepository(AuthToken).update({ id: row.id }, { revoked_at: new Date() });
      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'Membership',
          entity_id: userId,
          tenant_id: row.tenant_id,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { via: 'join_request', declined: true },
        },
        m,
      );
    });
  }
}
