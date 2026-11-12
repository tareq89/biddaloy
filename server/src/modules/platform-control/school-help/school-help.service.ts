import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalScope, AuditAction, ImpersonationEndedBy, UserRole } from '@biddaloy/shared';
import { RecoveryService } from '../../account-access/recovery.service';
import { AuditService } from '../../audit/audit.service';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { RefreshTokenService, RequestContext } from '../../auth/refresh-token.service';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import { School } from '../../schools/entities/school.entity';
import { ImpersonationSessionService } from '../../support-access/sessions/impersonation-session.service';
import { User } from '../../users/entities/user.entity';
import type { AdminResetLinkResponseDto, LogoutAllResponseDto } from './dto/school-help.dto';

const BATCH = 500;

/** [Epic 99, D7] Owner help for a school: admin reset link, sign everyone out. No notice is sent (the audit row is the record). */
@Injectable()
export class SchoolHelpService {
  constructor(
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly recovery: RecoveryService,
    private readonly cutoff: SessionCutoffService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly sessions: ImpersonationSessionService,
    private readonly audit: AuditService,
  ) {}

  async sendAdminResetLink(
    schoolId: string,
    userId: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<AdminResetLinkResponseDto> {
    // Soft-deleted rows are excluded by TypeORM. Same text for every miss: no echo.
    const member = await this.memberships.findOne({
      where: { tenant_id: schoolId, user_id: userId, role: UserRole.ADMIN },
    });
    const user = member && (await this.users.findOne({ where: { id: userId } }));
    if (!user) throw new NotFoundException('Admin not found');

    // A 409 SHARED_IDENTITY passes through unchanged.
    const result = await this.recovery.adminReset({
      user,
      tenantId: schoolId,
      actorUserId,
      context,
    });
    await this.audit.recordApproved({
      action: AuditAction.PLATFORM_ADMIN_RESET_SENT,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: schoolId,
      performed_by_user_id: actorUserId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { channel: result.channel },
      approved_by_user_id: actorUserId,
      approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
    });
    return { channel: result.channel, expiresAt: result.expires_at.toISOString() };
  }

  async logoutAll(
    schoolId: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<LogoutAllResponseDto> {
    if (!(await this.schools.exist({ where: { id: schoolId } }))) {
      throw new NotFoundException('School not found');
    }
    const at = new Date();
    const usersSignedOut = await this.users.manager.transaction(async (m) => {
      let count = 0;
      let after = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        // Keyset page over distinct live members; a user can hold several roles.
        const rows: { user_id: string }[] = await m.query(
          `SELECT DISTINCT "user_id" FROM "user_tenants"
           WHERE "tenant_id" = $1 AND "deleted_at" IS NULL AND "user_id" > $2
           ORDER BY "user_id" LIMIT $3`,
          [schoolId, after, BATCH],
        );
        if (rows.length === 0) break;
        for (const { user_id } of rows) {
          await this.cutoff.cutOff(user_id, m, at);
          await this.refreshTokens.revokeAllForUser(user_id, m);
        }
        count += rows.length;
        after = rows[rows.length - 1].user_id;
      }
      await this.audit.recordApproved(
        {
          action: AuditAction.PLATFORM_SCHOOL_LOGOUT_ALL,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: actorUserId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { usersSignedOut: count },
          approved_by_user_id: actorUserId,
          approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
        },
        m,
      );
      return count;
    });
    // Own transaction, so it runs after the commit above.
    await this.sessions.revokeAllForSchool(schoolId, ImpersonationEndedBy.OWNER);
    return { usersSignedOut };
  }
}
