import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationTrigger,
  UserStatus,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { RecoveryService } from './recovery.service';
import { AuthTokenService } from './auth-token.service';
import { OtpService, OTP_REDIS } from './otp.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { School } from '../schools/entities/school.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { SchoolsService } from '../schools/schools.service';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';

const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
const ADMIN_ID = '00000000-0000-4000-8000-000000000097';
const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('RecoveryService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: RecoveryService;
  let redis: Redis;
  let fakeProvider: { send: ReturnType<typeof vi.fn> };
  let fakeAuthService: {
    startSession: ReturnType<typeof vi.fn>;
    resetLoginLockouts: ReturnType<typeof vi.fn>;
    primaryTenantId: ReturnType<typeof vi.fn>;
  };
  let fakeRefreshTokens: { revokeAllForUser: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    fakeProvider = { send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }) };
    fakeAuthService = {
      startSession: vi.fn().mockResolvedValue({
        access_token: 'fake-access-token',
        memberships: [],
        refreshToken: { cookieValue: 'id.secret', expiresAt: new Date(Date.now() + 60_000) },
      }),
      resetLoginLockouts: vi.fn().mockResolvedValue(undefined),
      primaryTenantId: vi.fn().mockResolvedValue(SEED_TENANT_ID),
    };
    fakeRefreshTokens = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };

    module = await createTestModule(ALL_ENTITIES, [
      RecoveryService,
      AuthTokenService,
      OtpService,
      AccountAccessDeliveryService,
      AuditService,
      { provide: OTP_REDIS, useValue: redis },
      { provide: AuthService, useValue: fakeAuthService },
      { provide: RefreshTokenService, useValue: fakeRefreshTokens },
      {
        provide: SchoolsService,
        useFactory: (ds: DataSource) => ({
          findById: async (id: string) => ds.getRepository(School).findOneOrFail({ where: { id } }),
          getResolvedSettings: async () => ({ region: { locale: 'en-US' } }),
        }),
        inject: [DataSource],
      },
      {
        provide: CommunicationProviderRegistryService,
        useValue: { resolve: () => fakeProvider },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            key === 'APP_BASE_URL'
              ? 'http://localhost:5174'
              : key === 'ACCOUNT_ACCESS_ECHO_SECRETS'
                ? 'true'
                : undefined,
        },
      },
    ]);
    dataSource = module.get(DataSource);
    service = module.get(RecoveryService);
  });

  afterAll(async () => {
    await module.close();
    redis.disconnect();
  });

  beforeEach(async () => {
    fakeProvider.send.mockClear();
    fakeAuthService.startSession.mockClear();
    fakeAuthService.resetLoginLockouts.mockClear();
    fakeRefreshTokens.revokeAllForUser.mockClear();
    await redis.flushdb();
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM communication_logs');
    await dataSource.query('DELETE FROM auth_tokens');
    await dataSource.query('DELETE FROM user_tenants');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM schools');

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school-recovery' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school-recovery' }),
    );
  });

  async function createMember(overrides: Partial<User> = {}, tenantId = SEED_TENANT_ID) {
    const userRepo = dataSource.getRepository(User);
    const membershipRepo = dataSource.getRepository(UserTenant);
    const user = await userRepo.save(
      userRepo.create({
        full_name: 'Rahima',
        status: UserStatus.ACTIVE,
        password_hash: await bcrypt.hash('old-password', 4),
        ...overrides,
      }),
    );
    await membershipRepo.save(
      membershipRepo.create({ user_id: user.id, tenant_id: tenantId, role: 'PARENT' as any }),
    );
    return user;
  }

  describe('forgot', () => {
    it('returns 202-shaped {} and writes no communication_log for an unknown identifier', async () => {
      const result = await service.forgot('nobody@example.com', context);
      expect(result).toEqual({});

      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(0);
    });

    it('sends exactly one SMS and audits PASSWORD_RESET_REQUESTED for a known phone', async () => {
      const user = await createMember({ email: null, phone: '01712345678' });

      const result = await service.forgot('01712345678', context);

      expect(result.debug?.otp).toMatch(/^\d{6}$/);
      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(1);
      expect(logs[0].medium).toBe(CommunicationMedium.SMS);
      expect(logs[0].trigger).toBe(CommunicationTrigger.ACCOUNT_ACCESS);
      // D4: the secret never sits in the stored body.
      expect(logs[0].message_body).not.toContain(result.debug!.otp!);

      const auditRows = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.PASSWORD_RESET_REQUESTED } });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].new_values).toEqual({ channel: CommunicationMedium.SMS });
    });

    it('sends exactly one email and issues an auth_tokens PASSWORD_RESET row for a known email', async () => {
      const user = await createMember({ email: 'forgot@example.com', phone: null });

      const result = await service.forgot('forgot@example.com', context);

      expect(result.debug?.token).toBeTruthy();
      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(1);
      expect(logs[0].medium).toBe(CommunicationMedium.EMAIL);

      const tokenRows = await dataSource.query(
        `SELECT * FROM auth_tokens WHERE user_id = $1 AND purpose = 'PASSWORD_RESET'`,
        [user.id],
      );
      expect(tokenRows).toHaveLength(1);
    });

    it('returns {} and sends nothing for a suspended user', async () => {
      await createMember({ email: 'suspended@example.com', status: UserStatus.SUSPENDED });

      const result = await service.forgot('suspended@example.com', context);

      expect(result).toEqual({});
      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(0);
    });
  });

  describe('reset via OTP', () => {
    it('locks after 5 wrong attempts, and the right code after lock still 429s', async () => {
      const user = await createMember({ email: null, phone: '01711111111' });
      const { debug } = await service.forgot('01711111111', context);
      const rightOtp = debug!.otp!;

      // First 4 wrong guesses are plain "invalid" (401) — the 5th trips
      // OtpService's own lock (D3: 5 attempts) and becomes a 429 instead.
      for (let i = 0; i < 4; i++) {
        await expect(
          service.reset(
            { new_password: 'a-new-strong-password', phone: user.phone!, otp: '000000' },
            context,
          ),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      await expect(
        service.reset(
          { new_password: 'a-new-strong-password', phone: user.phone!, otp: '000000' },
          context,
        ),
      ).rejects.toMatchObject({ status: 429 });

      await expect(
        service.reset(
          { new_password: 'a-new-strong-password', phone: user.phone!, otp: rightOtp },
          context,
        ),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('changes the password, revokes all refresh tokens, audits, and returns a session', async () => {
      const user = await createMember({ email: null, phone: '01722222222' });
      const { debug } = await service.forgot('01722222222', context);

      const result = await service.reset(
        { new_password: 'a-new-strong-password', phone: user.phone!, otp: debug!.otp! },
        context,
      );

      expect(result.access_token).toBe('fake-access-token');
      expect(fakeRefreshTokens.revokeAllForUser).toHaveBeenCalledWith(user.id);
      expect(fakeAuthService.startSession).toHaveBeenCalledTimes(1);

      const updated = await dataSource
        .getRepository(User)
        .findOneOrFail({ where: { id: user.id } });
      await expect(bcrypt.compare('a-new-strong-password', updated.password_hash!)).resolves.toBe(
        true,
      );

      const auditRows = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.PASSWORD_RESET } });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].new_values).toEqual({ method: 'otp' });
    });
  });

  describe('reset via link', () => {
    it('rejects a consumed token with 401', async () => {
      const user = await createMember({ email: 'link@example.com', phone: null });
      const { debug } = await service.forgot('link@example.com', context);
      const token = debug!.token!;

      await service.reset({ new_password: 'first-strong-password', token }, context);

      await expect(
        service.reset({ new_password: 'second-strong-password', token }, context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      void user;
    });

    it('rejects an expired token with 401', async () => {
      const user = await createMember({ email: 'expired@example.com', phone: null });
      const authTokens = module.get(AuthTokenService);
      const { raw } = await authTokens.issue({
        userId: user.id,
        tenantId: SEED_TENANT_ID,
        purpose: 'PASSWORD_RESET' as any,
        ttlMs: -1000,
      });

      await expect(
        service.reset({ new_password: 'a-new-strong-password', token: raw }, context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('adminReset', () => {
    it('revokes the target refresh tokens immediately and sends via their available channel', async () => {
      const admin = await createMember({ email: 'admin@example.com', phone: null });
      const user = await createMember({ email: null, phone: '01733333333' });

      const result = await service.adminReset({
        user,
        tenantId: SEED_TENANT_ID,
        actorUserId: admin.id,
        context,
      });

      expect(result.channel).toBe(CommunicationMedium.SMS);
      expect(fakeRefreshTokens.revokeAllForUser).toHaveBeenCalledWith(user.id);

      const auditRows = await dataSource.getRepository(AuditLog).find({
        where: { entity_id: user.id, action: AuditAction.PASSWORD_RESET_REQUESTED },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].performed_by_user_id).toBe(admin.id);
      expect(auditRows[0].new_values).toMatchObject({ admin_initiated: true });
    });

    it('rejects a user with no email or phone with 400', async () => {
      const user = await createMember({ email: null, phone: null });

      await expect(
        service.adminReset({ user, tenantId: SEED_TENANT_ID, actorUserId: ADMIN_ID, context }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('404s when the target has no membership in tenantId', async () => {
      const user = await createMember({ email: null, phone: '01744444444' }, OTHER_TENANT);

      await expect(
        service.adminReset({ user, tenantId: SEED_TENANT_ID, actorUserId: ADMIN_ID, context }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
