import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuditAction, AuthTokenPurpose, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { ActivationService } from './activation.service';
import { AuthTokenService, INVITE_TTL_MS } from './auth-token.service';
import { InvitationService } from './invitation.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { User } from '../users/entities/user.entity';
import { School } from '../schools/entities/school.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SchoolsService } from '../schools/schools.service';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';
import { AuthToken } from './entities/auth-token.entity';

describe('ActivationService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: ActivationService;
  let authTokens: AuthTokenService;
  let fakeAuthService: {
    startSession: ReturnType<typeof vi.fn>;
    resetLoginLockouts: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    fakeAuthService = {
      startSession: vi.fn().mockResolvedValue({
        access_token: 'fake-access-token',
        memberships: [],
        refreshToken: { cookieValue: 'id.secret', expiresAt: new Date(Date.now() + 60_000) },
      }),
      resetLoginLockouts: vi.fn().mockResolvedValue(undefined),
    };

    module = await createTestModule(ALL_ENTITIES, [
      ActivationService,
      AuthTokenService,
      InvitationService,
      AccountAccessDeliveryService,
      AuditService,
      { provide: AuthService, useValue: fakeAuthService },
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
        useValue: { resolve: () => ({ send: vi.fn().mockResolvedValue({ success: true }) }) },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => (key === 'APP_BASE_URL' ? 'http://localhost:5174' : undefined),
        },
      },
    ]);
    dataSource = module.get(DataSource);
    service = module.get(ActivationService);
    authTokens = module.get(AuthTokenService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    fakeAuthService.startSession.mockClear();
    fakeAuthService.resetLoginLockouts.mockClear();
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM auth_tokens');
    await dataSource.query('DELETE FROM user_tenants');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM schools');

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school-activate' }),
    );
  });

  async function createInvitee(overrides: Partial<User> = {}) {
    const userRepo = dataSource.getRepository(User);
    return userRepo.save(
      userRepo.create({
        full_name: 'Rahima',
        email: 'rahima@example.com',
        status: UserStatus.INACTIVE,
        password_hash: null,
        ...overrides,
      }),
    );
  }

  async function issueInvite(userId: string, ttlMs = INVITE_TTL_MS) {
    return authTokens.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs,
    });
  }

  const context = { ip: '127.0.0.1', userAgent: 'vitest' };

  describe('verify', () => {
    it('returns full_name and school_name, never email/phone, for a valid token', async () => {
      const user = await createInvitee();
      const { raw } = await issueInvite(user.id);

      const result = await service.verify(raw);

      expect(result).toEqual({
        status: 'valid',
        full_name: 'Rahima',
        school_name: 'Test School',
      });
    });

    it('returns unknown for a garbage token', async () => {
      expect(await service.verify('not-a-real-token')).toEqual({ status: 'unknown' });
    });
  });

  describe('activate', () => {
    it('sets a bcrypt hash, consumes the token, activates the user, and returns a session', async () => {
      const user = await createInvitee();
      const { raw } = await issueInvite(user.id);

      const result = await service.activate(raw, 'a-strong-password', context);

      expect(result.access_token).toBe('fake-access-token');
      expect(fakeAuthService.startSession).toHaveBeenCalledTimes(1);
      expect(fakeAuthService.resetLoginLockouts).toHaveBeenCalledTimes(1);

      const updated = await dataSource
        .getRepository(User)
        .findOneOrFail({ where: { id: user.id } });
      expect(updated.status).toBe(UserStatus.ACTIVE);
      expect(updated.password_hash).not.toBeNull();
      await expect(bcrypt.compare('a-strong-password', updated.password_hash!)).resolves.toBe(true);

      const auditRows = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.ACCOUNT_ACTIVATED } });
      expect(auditRows).toHaveLength(1);
    });

    it('rejects a second activation of the same (now-consumed) token with 400 consumed', async () => {
      const user = await createInvitee();
      const { raw } = await issueInvite(user.id);
      await service.activate(raw, 'a-strong-password', context);

      await expect(service.activate(raw, 'another-password', context)).rejects.toMatchObject({
        response: { message: 'consumed' },
        status: 400,
      });
    });

    it('rejects an expired token with 400 expired', async () => {
      const user = await createInvitee();
      const { raw } = await issueInvite(user.id, -1000);

      await expect(service.activate(raw, 'a-strong-password', context)).rejects.toMatchObject({
        response: { message: 'expired' },
        status: 400,
      });
    });

    it('rejects a suspended user with 400, never activating them', async () => {
      const user = await createInvitee({ status: UserStatus.SUSPENDED });
      const { raw } = await issueInvite(user.id);

      await expect(service.activate(raw, 'a-strong-password', context)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const untouched = await dataSource
        .getRepository(User)
        .findOneOrFail({ where: { id: user.id } });
      expect(untouched.status).toBe(UserStatus.SUSPENDED);
      expect(untouched.password_hash).toBeNull();
    });
  });

  describe('resend', () => {
    it('is a silent no-op for an unknown identifier', async () => {
      await expect(service.resend('nobody@example.com')).resolves.toBeUndefined();
    });

    it('is a silent no-op for an account that already has a password', async () => {
      const user = await createInvitee({ password_hash: 'already-set', status: UserStatus.ACTIVE });
      await issueInvite(user.id);

      await expect(service.resend(user.email!)).resolves.toBeUndefined();
    });

    it('does not reissue a revoked invitation', async () => {
      const user = await createInvitee();
      await issueInvite(user.id);
      await authTokens.revokeLive(user.id, AuthTokenPurpose.INVITE);

      await service.resend(user.email!);

      const tokenCount = await dataSource
        .getRepository(AuthToken)
        .createQueryBuilder('t')
        .where('t.user_id = :userId', { userId: user.id })
        .andWhere('t.revoked_at IS NULL')
        .andWhere('t.consumed_at IS NULL')
        .getCount();
      expect(tokenCount).toBe(0);
    });

    it('does not reissue an already-consumed invitation', async () => {
      const user = await createInvitee();
      const { row } = await issueInvite(user.id);
      await authTokens.consume(row.id);

      await service.resend(user.email!);

      const tokenCount = await dataSource
        .getRepository(AuthToken)
        .createQueryBuilder('t')
        .where('t.user_id = :userId', { userId: user.id })
        .andWhere('t.revoked_at IS NULL')
        .andWhere('t.consumed_at IS NULL')
        .getCount();
      expect(tokenCount).toBe(0);
    });
  });
});
