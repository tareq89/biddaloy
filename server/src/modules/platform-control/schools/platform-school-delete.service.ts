import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApprovalScope, AuditAction, ImpersonationEndedBy } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { RefreshTokenService, RequestContext } from '../../auth/refresh-token.service';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import {
  BILLING_SUSPENSION_REASONS,
  TenantStatusService,
} from '../../schools/tenant-status.service';
import { ImpersonationSessionService } from '../../support-access/sessions/impersonation-session.service';

const BATCH = 500;

export interface DeletableSchool {
  id: string;
  name: string;
  slug: string;
}

/**
 * [Epic 99 #3805, D5, D7] Soft-delete a school. Not revivable from the app (`revive` takes only
 * an IDLE pause) and never a hard delete (D40). The platform home school is refused with 409.
 * Every miss (unknown, already deleted) is the same 404 with no echo (Rule 23).
 */
@Injectable()
export class PlatformSchoolDeleteService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly cutoff: SessionCutoffService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly sessions: ImpersonationSessionService,
    private readonly tenantStatus: TenantStatusService,
    private readonly audit: AuditService,
  ) {}

  /** Cheap pre-check the controller runs BEFORE filing an approval request. */
  async assertDeletable(schoolId: string): Promise<DeletableSchool> {
    const rows: (DeletableSchool & { is_platform: boolean })[] = await this.db.query(
      `SELECT id, name, slug, is_platform FROM schools WHERE id = $1 AND deleted_at IS NULL`,
      [schoolId],
    );
    return this.pick(rows[0]);
  }

  async delete(
    schoolId: string,
    reason: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<{ id: string; deletedAt: Date }> {
    // A billing code would open the backup export door (D16); the reason must be words.
    if (BILLING_SUSPENSION_REASONS.includes(reason.trim().toUpperCase())) {
      throw new BadRequestException({
        message: 'That reason is a reserved billing code; write the reason in words',
        details: { code: 'RESERVED_STATUS_REASON' },
      });
    }
    const now = new Date();
    await this.db.transaction(async (m) => {
      // Row lock: two owners' deletes serialise and the second finds it gone (404).
      const rows: {
        id: string;
        status: string;
        status_reason: string | null;
        is_platform: boolean;
      }[] = await m.query(
        `SELECT id, status, status_reason, is_platform FROM schools
            WHERE id = $1 AND deleted_at IS NULL FOR NO KEY UPDATE`,
        [schoolId],
      );
      const school = rows[0];
      this.pick(school);
      await m.query(
        `UPDATE schools
            SET deleted_at = $2, status = 'SUSPENDED', status_reason = $3, status_changed_at = $2
          WHERE id = $1`,
        [schoolId, now, reason],
      );
      await this.cutMembersOff(m, schoolId, now);
      await this.audit.recordApproved(
        {
          action: AuditAction.DELETE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: actorUserId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: school.status, reason: school.status_reason },
          new_values: { deleted: true, reason },
          approved_by_user_id: actorUserId,
          approval_scope: ApprovalScope.PLATFORM_DELETE_SCHOOL,
        },
        m,
      );
    });
    // Own transactions / caches, so after the commit.
    try {
      await this.sessions.revokeAllForSchool(schoolId, ImpersonationEndedBy.OWNER);
    } finally {
      // Always drop the cached status, even if the Login as revocation failed.
      await this.tenantStatus.invalidate(schoolId);
    }
    return { id: schoolId, deletedAt: now };
  }

  private pick<T extends { is_platform: boolean }>(row: T | undefined): T {
    if (!row) throw new NotFoundException('School not found');
    if (row.is_platform) {
      throw platformHome();
    }
    return row;
  }

  private async cutMembersOff(m: EntityManager, schoolId: string, at: Date): Promise<void> {
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      // Keyset page over distinct live members; a user can hold several roles.
      const rows: { user_id: string }[] = await m.query(
        `SELECT DISTINCT "user_id" FROM "user_tenants"
          WHERE "tenant_id" = $1 AND "deleted_at" IS NULL AND "user_id" > $2
          ORDER BY "user_id" LIMIT $3`,
        [schoolId, after, BATCH],
      );
      if (rows.length === 0) return;
      for (const { user_id } of rows) {
        await this.cutoff.cutOff(user_id, m, at);
        await this.refreshTokens.revokeAllForUser(user_id, m);
      }
      after = rows[rows.length - 1].user_id;
    }
  }
}

const platformHome = () =>
  new ConflictException({
    message: 'The platform home school cannot be deleted',
    details: { code: 'PLATFORM_HOME_SCHOOL' },
  });
