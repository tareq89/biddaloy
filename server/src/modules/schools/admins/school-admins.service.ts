import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditAction, AuthTokenPurpose, InvitationStatus, UserRole } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { AuditService } from '../../audit/audit.service';
import { AuthTokenService } from '../../account-access/auth-token.service';
import { InvitationService } from '../../account-access/invitation.service';
import { deriveInvitationStatus } from '../../account-access/invitation-status.util';
import { SchoolsService } from '../schools.service';
import { ProvisioningService, AdminInput } from '../provisioning/provisioning.service';

export interface SchoolAdminListItem {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  membership_status: string;
  invitation: { id: string; status: InvitationStatus; expires_at: Date } | null;
}

export interface AddSchoolAdminResult {
  admin: { user_id: string; existed: boolean };
  invitation: { id: string; status: string };
}

/**
 * `GET/POST /schools/:id/admins` + resend/revoke (#531): SUPER_ADMIN
 * recovery console for a school's ADMIN access, no DB access needed. The
 * add-admin path reuses `ProvisioningService.provisionAdminForSchool` (the
 * same find-or-create-user/membership/invitation logic `POST /schools`
 * uses) rather than duplicating it — see that method's doc comment.
 *
 * Scope: ADMIN role only. General staff-role management (TEACHER,
 * ACCOUNTANT, etc.) is explicitly out of scope for this issue.
 */
@Injectable()
export class SchoolAdminsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly schools: SchoolsService,
    private readonly provisioning: ProvisioningService,
    private readonly invitations: InvitationService,
    private readonly authTokens: AuthTokenService,
    private readonly audit: AuditService,
  ) {}

  async list(schoolId: string): Promise<SchoolAdminListItem[]> {
    await this.schools.findById(schoolId);

    const memberships = await this.userTenantRepo.find({
      where: { tenant_id: schoolId, role: UserRole.ADMIN },
      relations: { user: true },
    });
    const admins = memberships.map((m) => m.user).filter((u): u is User => !!u);

    const latestByUserId = await this.authTokens.latestMany(
      admins.map((u) => u.id),
      AuthTokenPurpose.INVITE,
      schoolId,
    );

    return admins.map((user) => {
      const latest = latestByUserId.get(user.id) ?? null;
      const status = deriveInvitationStatus(user, latest);
      return {
        user_id: user.id,
        name: user.full_name,
        email: user.email,
        phone: user.phone,
        membership_status: user.status,
        invitation: latest ? { id: latest.id, status, expires_at: latest.expires_at } : null,
      };
    });
  }

  async addAdmin(
    schoolId: string,
    admin: AdminInput,
    actorUserId: string,
  ): Promise<AddSchoolAdminResult> {
    await this.schools.findById(schoolId);

    let deliverAfterCommit: (() => Promise<void>) | null = null;
    const { result } = await this.dataSource.transaction(async (manager) => {
      const provisioned = await this.provisioning.provisionAdminForSchool(
        schoolId,
        admin,
        actorUserId,
        manager,
      );
      deliverAfterCommit = provisioned.deliverAfterCommit;

      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: actorUserId,
          new_values: {
            operation: 'ADD_ADMIN',
            target_user_id: provisioned.result.admin.user_id,
          },
        },
        manager,
      );

      return { result: provisioned.result };
    });

    if (deliverAfterCommit) {
      // Delivery failures must not undo the already-committed
      // user/membership/invitation — same fail-open behavior as
      // `ProvisioningService.provision`.
      await (deliverAfterCommit as () => Promise<void>)().catch(() => undefined);
    }

    return result;
  }

  async resendInvitation(schoolId: string, userId: string, actorUserId: string): Promise<void> {
    await this.schools.findById(schoolId);
    await this.assertAdminMember(schoolId, userId);

    await this.invitations.issueAndSend({
      userId,
      tenantId: schoolId,
      actorUserId,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'School',
      entity_id: schoolId,
      tenant_id: schoolId,
      performed_by_user_id: actorUserId,
      new_values: { operation: 'RESEND_ADMIN_INVITATION', target_user_id: userId },
    });
  }

  async revokeInvitation(schoolId: string, userId: string, actorUserId: string): Promise<void> {
    await this.schools.findById(schoolId);
    await this.assertAdminMember(schoolId, userId);

    await this.invitations.revoke({ userId, tenantId: schoolId, actorUserId });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'School',
      entity_id: schoolId,
      tenant_id: schoolId,
      performed_by_user_id: actorUserId,
      new_values: { operation: 'REVOKE_ADMIN_INVITATION', target_user_id: userId },
    });
  }

  private async assertAdminMember(schoolId: string, userId: string): Promise<void> {
    const membership = await this.userTenantRepo.findOne({
      where: { tenant_id: schoolId, user_id: userId, role: UserRole.ADMIN },
    });
    if (!membership) {
      throw new NotFoundException(`ADMIN with ID "${userId}" not found on this school`);
    }
  }
}
