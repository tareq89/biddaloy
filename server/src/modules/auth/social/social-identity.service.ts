import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction, SocialProvider } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { UserIdentity } from '../entities/user-identity.entity';
import { AuditService } from '../../audit/audit.service';
import { AuthService } from '../auth.service';
import { OtpLoginService } from '../../account-access/otp-login.service';
import type { RequestContext } from '../../../common/request-context.util';
import type { SocialTicket } from './social-ticket.service';

const UNIQUE_VIOLATION = '23505';

/** The only code that writes `user_identities`. Never matches by email (D9). */
@Injectable()
export class SocialIdentityService {
  constructor(
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
    private readonly otpLogin: OtpLoginService,
  ) {}

  findBySubject(provider: SocialProvider, subject: string): Promise<UserIdentity | null> {
    return this.identities.findOne({ where: { provider, subject } });
  }

  list(userId: string): Promise<UserIdentity[]> {
    return this.identities.find({ where: { user_id: userId }, order: { created_at: 'ASC' } });
  }

  /**
   * Connects a social account to `userId`. Returns false when the account is
   * already connected to someone else, or the user already has another
   * account of that provider (nothing is changed then).
   */
  async link(
    userId: string,
    ticket: SocialTicket,
    manager?: EntityManager,
    context?: RequestContext,
    /** Registration passes the new school's id; otherwise the user's primary tenant is used. */
    tenantId?: string | null,
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(UserIdentity) : this.identities;
    const provider = ticket.provider as SocialProvider;

    const bySubject = await repo.findOne({ where: { provider, subject: ticket.subject } });
    if (bySubject) return bySubject.user_id === userId;
    if (await repo.findOne({ where: { user_id: userId, provider } })) return false;

    try {
      const row = await repo.save(
        repo.create({ user_id: userId, provider, subject: ticket.subject, email: ticket.email }),
      );
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'UserIdentity',
          entity_id: row.id,
          tenant_id:
            tenantId !== undefined ? tenantId : await this.authService.primaryTenantId(userId),
          performed_by_user_id: userId,
          ip_address: context?.ip ?? null,
          user_agent: context?.userAgent ?? null,
          new_values: { provider },
        },
        manager,
      );
      return true;
    } catch (error) {
      // A concurrent connect won the unique index; same outcome as the pre-check.
      // Inside a caller's transaction Postgres has already aborted it, so the
      // caller must see the error and roll back rather than carry on.
      if (!manager && (error as { code?: string }).code === UNIQUE_VIOLATION) return false;
      throw error;
    }
  }

  /**
   * Meta's data-deletion callback: removes only the `provider`+`subject`
   * identity row(s). Never touches the user or any school data. One
   * `DELETE ... RETURNING` (no load-mutate-save, no find-then-delete race),
   * audited in the same transaction. Audited even when nothing matched, so
   * every confirmation code handed back to Meta can be found later.
   */
  async deleteBySubject(
    provider: SocialProvider,
    subject: string,
    confirmationCode: string,
    context: RequestContext,
  ): Promise<void> {
    await this.identities.manager.transaction(async (manager) => {
      const { raw } = await manager
        .createQueryBuilder()
        .delete()
        .from(UserIdentity)
        .where({ provider, subject })
        .returning(['id', 'user_id'])
        .execute();
      const rows = raw as Array<{ id: string; user_id: string }>;
      const entry = {
        action: AuditAction.DELETE,
        entity_type: 'UserIdentity' as const,
        performed_by_user_id: null,
        ip_address: context.ip,
        user_agent: context.userAgent,
        old_values: {
          provider,
          reason: 'provider_data_deletion_callback',
          confirmation_code: confirmationCode,
        },
      };
      if (!rows.length) {
        await this.audit.record({ ...entry, entity_id: null, tenant_id: null }, manager);
      }
      for (const row of rows) {
        await this.audit.record(
          {
            ...entry,
            entity_id: row.id,
            tenant_id: await this.authService.primaryTenantId(row.user_id),
          },
          manager,
        );
      }
    });
  }

  /** Refuses to remove the last way to sign in (409 LAST_SIGN_IN_METHOD). */
  async unlink(userId: string, provider: SocialProvider, context: RequestContext): Promise<void> {
    const identity = await this.identities.findOne({ where: { user_id: userId, provider } });
    if (!identity) throw new NotFoundException('Identity not connected');

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Identity not connected');
    // Another way in must remain: a password, another connected account, or
    // an address code sign-in would really send to.
    const otherIdentity = (await this.identities.count({ where: { user_id: userId } })) > 1;
    if (!user.password_hash && !otherIdentity && !(await this.otpLogin.canReceiveCode(user))) {
      throw new ConflictException({
        message: 'This is the last way to sign in to this account.',
        details: { code: 'LAST_SIGN_IN_METHOD' },
      });
    }

    await this.identities.delete({ id: identity.id });
    await this.audit.record({
      action: AuditAction.DELETE,
      entity_type: 'UserIdentity',
      entity_id: identity.id,
      tenant_id: await this.authService.primaryTenantId(userId),
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      old_values: { provider },
    });
  }
}
