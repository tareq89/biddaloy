import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchoolStatus, UserRole, UserStatus } from '@biddaloy/shared';
import { SchoolAdminsService } from './school-admins.service';

describe('SchoolAdminsService', () => {
  const SCHOOL_ID = 'school-1';
  const ACTOR = 'super-admin-1';

  let dataSource: any;
  let userRepo: any;
  let userTenantRepo: any;
  let schools: any;
  let provisioning: any;
  let invitations: any;
  let authTokens: any;
  let audit: any;
  let service: SchoolAdminsService;

  beforeEach(() => {
    dataSource = {
      transaction: vi.fn(async (cb: (m: any) => Promise<unknown>) => cb({})),
    };
    userRepo = {};
    userTenantRepo = {
      find: vi.fn(),
      findOne: vi.fn(),
    };
    schools = {
      findById: vi.fn().mockResolvedValue({ id: SCHOOL_ID, status: SchoolStatus.ACTIVE }),
    };
    provisioning = {
      provisionAdminForSchool: vi.fn(),
    };
    invitations = {
      issueAndSend: vi.fn().mockResolvedValue({ status: 'SENT' }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    authTokens = {
      latestMany: vi.fn(),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };

    service = new SchoolAdminsService(
      dataSource,
      userRepo,
      userTenantRepo,
      schools,
      provisioning,
      invitations,
      authTokens,
      audit,
    );
  });

  describe('list', () => {
    it('shapes ADMIN memberships with their invitation status', async () => {
      const user = {
        id: 'user-1',
        full_name: 'Admin One',
        email: 'admin@example.com',
        phone: null,
        status: UserStatus.ACTIVE,
        password_hash: null,
      };
      userTenantRepo.find.mockResolvedValue([{ user }]);
      const expires = new Date(Date.now() + 60_000);
      authTokens.latestMany.mockResolvedValue(
        new Map([
          ['user-1', { id: 'invite-1', consumed_at: null, revoked_at: null, expires_at: expires }],
        ]),
      );

      const result = await service.list(SCHOOL_ID);

      expect(schools.findById).toHaveBeenCalledWith(SCHOOL_ID);
      expect(userTenantRepo.find).toHaveBeenCalledWith({
        where: { tenant_id: SCHOOL_ID, role: UserRole.ADMIN },
        relations: { user: true },
      });
      expect(result).toEqual([
        {
          user_id: 'user-1',
          name: 'Admin One',
          email: 'admin@example.com',
          phone: null,
          membership_status: UserStatus.ACTIVE,
          invitation: { id: 'invite-1', status: 'PENDING', expires_at: expires },
        },
      ]);
    });

    it('returns invitation: null when no invite has ever been issued', async () => {
      const user = {
        id: 'user-2',
        full_name: 'Admin Two',
        email: 'admin2@example.com',
        phone: null,
        status: UserStatus.ACTIVE,
        password_hash: null,
      };
      userTenantRepo.find.mockResolvedValue([{ user }]);
      authTokens.latestMany.mockResolvedValue(new Map());

      const result = await service.list(SCHOOL_ID);

      expect(result[0].invitation).toBeNull();
    });
  });

  describe('addAdmin', () => {
    it('reuses ProvisioningService.provisionAdminForSchool and audits the operation', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      provisioning.provisionAdminForSchool.mockResolvedValue({
        result: {
          admin: { user_id: 'user-1', existed: true },
          invitation: { id: 'invite-1', status: 'PENDING' },
        },
        deliverAfterCommit: deliver,
      });

      const dto = { name: 'Admin One', email: 'admin@example.com' };
      const result = await service.addAdmin(SCHOOL_ID, dto, ACTOR);

      // No duplicate user created — the shared method reports `existed: true`
      // and this service does no user creation of its own.
      expect(result.admin).toEqual({ user_id: 'user-1', existed: true });
      expect(provisioning.provisionAdminForSchool).toHaveBeenCalledWith(
        SCHOOL_ID,
        dto,
        ACTOR,
        expect.anything(),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'School',
          entity_id: SCHOOL_ID,
          performed_by_user_id: ACTOR,
          new_values: expect.objectContaining({
            operation: 'ADD_ADMIN',
            target_user_id: 'user-1',
          }),
        }),
        expect.anything(),
      );
      expect(deliver).toHaveBeenCalledTimes(1);
    });
  });

  describe('resendInvitation', () => {
    it('calls InvitationService.issueAndSend with the school/user ids and audits', async () => {
      userTenantRepo.findOne.mockResolvedValue({ user_id: 'user-1', tenant_id: SCHOOL_ID });

      await service.resendInvitation(SCHOOL_ID, 'user-1', ACTOR);

      expect(invitations.issueAndSend).toHaveBeenCalledWith({
        userId: 'user-1',
        tenantId: SCHOOL_ID,
        actorUserId: ACTOR,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'School',
          entity_id: SCHOOL_ID,
          new_values: expect.objectContaining({
            operation: 'RESEND_ADMIN_INVITATION',
            target_user_id: 'user-1',
          }),
        }),
      );
    });
  });

  describe('revokeInvitation', () => {
    it('calls InvitationService.revoke with the school/user ids and audits', async () => {
      userTenantRepo.findOne.mockResolvedValue({ user_id: 'user-1', tenant_id: SCHOOL_ID });

      await service.revokeInvitation(SCHOOL_ID, 'user-1', ACTOR);

      expect(invitations.revoke).toHaveBeenCalledWith({
        userId: 'user-1',
        tenantId: SCHOOL_ID,
        actorUserId: ACTOR,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'School',
          entity_id: SCHOOL_ID,
          new_values: expect.objectContaining({
            operation: 'REVOKE_ADMIN_INVITATION',
            target_user_id: 'user-1',
          }),
        }),
      );
    });
  });
});
