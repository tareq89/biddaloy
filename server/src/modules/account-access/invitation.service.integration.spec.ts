import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { CommunicationMedium, CommunicationTrigger, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { InvitationService } from './invitation.service';
import { AuthTokenService } from './auth-token.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';

const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

describe('InvitationService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: InvitationService;
  let fakeProvider: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    fakeProvider = { send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }) };

    module = await createTestModule(ALL_ENTITIES, [
      InvitationService,
      AuthTokenService,
      AccountAccessDeliveryService,
      AuditService,
      {
        provide: SchoolsService,
        useFactory: (ds: DataSource) => ({
          findById: async (id: string) => ds.getRepository(School).findOneOrFail({ where: { id } }),
          getResolvedSettings: async () => ({ region: { locale: 'en-US' } }),
        }),
        inject: [DataSource],
      },
      {
        // Only the resolve() surface AccountAccessDeliveryService's path
        // needs — a real SMS/email gateway is exactly what this test
        // must not touch.
        provide: CommunicationProviderRegistryService,
        useValue: { resolve: () => fakeProvider },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => (key === 'APP_BASE_URL' ? 'http://localhost:5174' : undefined),
        },
      },
    ]);
    dataSource = module.get(DataSource);
    service = module.get(InvitationService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    fakeProvider.send.mockClear();
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM communication_logs');
    await dataSource.query('DELETE FROM auth_tokens');
    await dataSource.query('DELETE FROM user_tenants');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM schools');

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({
        id: SEED_TENANT_ID,
        name: 'Test School',
        slug: 'test-school-inv',
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await schoolRepo.save(
      schoolRepo.create({
        id: OTHER_TENANT,
        name: 'Other School',
        slug: 'other-school-inv',
        tenant_id: OTHER_TENANT,
      }),
    );
  });

  async function createMember(tenantId: string, overrides: Partial<User> = {}) {
    const userRepo = dataSource.getRepository(User);
    const membershipRepo = dataSource.getRepository(UserTenant);
    const user = await userRepo.save(
      userRepo.create({
        full_name: 'Invitee',
        email: 'invitee@example.com',
        status: UserStatus.ACTIVE,
        ...overrides,
      }),
    );
    await membershipRepo.save(
      membershipRepo.create({ user_id: user.id, tenant_id: tenantId, role: 'TEACHER' as any }),
    );
    return user;
  }

  it('sends exactly one communication_logs row with trigger ACCOUNT_ACCESS for a passwordless user', async () => {
    const user = await createMember(SEED_TENANT_ID);

    const result = await service.issueAndSend({
      userId: user.id,
      tenantId: SEED_TENANT_ID,
      actorUserId: user.id,
    });

    expect(result.medium).toBe(CommunicationMedium.EMAIL);
    const logs = await dataSource
      .getRepository(CommunicationLog)
      .find({ where: { tenant_id: SEED_TENANT_ID } });
    expect(logs).toHaveLength(1);
    expect(logs[0].trigger).toBe(CommunicationTrigger.ACCOUNT_ACCESS);
    expect(fakeProvider.send).toHaveBeenCalledTimes(1);
  });

  it('rejects a user who already has a password with 409', async () => {
    const user = await createMember(SEED_TENANT_ID, { password_hash: 'already-set' });

    await expect(
      service.issueAndSend({ userId: user.id, tenantId: SEED_TENANT_ID, actorUserId: user.id }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a user with no email or phone with 400', async () => {
    const user = await createMember(SEED_TENANT_ID, { email: null, phone: null });

    await expect(
      service.issueAndSend({ userId: user.id, tenantId: SEED_TENANT_ID, actorUserId: user.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for a user id that belongs to a different tenant', async () => {
    const user = await createMember(OTHER_TENANT);

    await expect(
      service.issueAndSend({ userId: user.id, tenantId: SEED_TENANT_ID, actorUserId: user.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
