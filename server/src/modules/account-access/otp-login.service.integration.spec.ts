import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { AuditAction, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { OtpLoginService } from './otp-login.service';
import { OtpService, OTP_REDIS } from './otp.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { School } from '../schools/entities/school.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { SchoolsService } from '../schools/schools.service';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';

const OTHER_TENANT = '00000000-0000-4000-8000-000000000198';
const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('OtpLoginService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: OtpLoginService;
  let redis: Redis;
  let fakeProvider: { send: ReturnType<typeof vi.fn> };
  let fakeAuthService: {
    startSession: ReturnType<typeof vi.fn>;
    primaryTenantId: ReturnType<typeof vi.fn>;
  };
  let fakeLoginAttempts: { reset: ReturnType<typeof vi.fn> };
  // tenantId -> otpLoginEnabled, defaulting to true for any tenant not listed.
  let tenantOtpEnabled: Map<string, boolean>;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    fakeProvider = { send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }) };
    fakeAuthService = {
      startSession: vi.fn().mockResolvedValue({
        access_token: 'fake-access-token',
        memberships: [],
        refreshToken: { cookieValue: 'id.secret', expiresAt: new Date(Date.now() + 60_000) },
      }),
      primaryTenantId: vi.fn().mockImplementation(async (userId: string) => {
        const membershipRepo = dataSource.getRepository(UserTenant);
        const m = await membershipRepo.findOne({ where: { user_id: userId } });
        return m?.tenant_id ?? null;
      }),
    };
    fakeLoginAttempts = { reset: vi.fn().mockResolvedValue(undefined) };
    tenantOtpEnabled = new Map();

    module = await createTestModule(ALL_ENTITIES, [
      OtpLoginService,
      OtpService,
      AccountAccessDeliveryService,
      AuditService,
      { provide: OTP_REDIS, useValue: redis },
      { provide: AuthService, useValue: fakeAuthService },
      { provide: LoginAttemptService, useValue: fakeLoginAttempts },
      {
        provide: SchoolsService,
        useFactory: (ds: DataSource) => ({
          findById: async (id: string) => ds.getRepository(School).findOneOrFail({ where: { id } }),
          getResolvedSettings: async (tenantId: string) => ({
            region: { locale: 'en-US' },
            auth: { otpLoginEnabled: tenantOtpEnabled.get(tenantId) ?? true },
          }),
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
          get: (key: string) => (key === 'ACCOUNT_ACCESS_ECHO_SECRETS' ? 'true' : undefined),
        },
      },
    ]);
    dataSource = module.get(DataSource);
    service = module.get(OtpLoginService);
  });

  afterAll(async () => {
    await module.close();
    redis.disconnect();
  });

  beforeEach(async () => {
    fakeProvider.send.mockClear();
    fakeAuthService.startSession.mockClear();
    fakeLoginAttempts.reset.mockClear();
    tenantOtpEnabled.clear();
    await redis.flushdb();
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM communication_logs');
    await dataSource.query('DELETE FROM user_tenants');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM schools');

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school-otp-login' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school-otp-login' }),
    );
  });

  async function createMember(
    overrides: Partial<User> = {},
    tenantIds: string[] = [SEED_TENANT_ID],
  ) {
    const userRepo = dataSource.getRepository(User);
    const membershipRepo = dataSource.getRepository(UserTenant);
    const user = await userRepo.save(
      userRepo.create({
        full_name: 'Karim',
        status: UserStatus.ACTIVE,
        password_hash: null,
        ...overrides,
      }),
    );
    for (const tenantId of tenantIds) {
      await membershipRepo.save(
        membershipRepo.create({ user_id: user.id, tenant_id: tenantId, role: 'PARENT' as any }),
      );
    }
    return user;
  }

  describe('request', () => {
    it('returns 202-shaped {} and writes no communication_log for an unknown phone', async () => {
      const result = await service.request('01700000000', context);
      expect(result).toEqual({});
      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(0);
    });

    it('sends exactly one SMS for a known, active phone', async () => {
      const user = await createMember({ phone: '01712345678' });

      const result = await service.request('01712345678', context);

      expect(result.debug?.otp).toMatch(/^\d{6}$/);
      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(1);
      expect(logs[0].medium).toBe(CommunicationMedium.SMS);
      void user;
    });

    it('returns {} and sends nothing when the tenant has otpLoginEnabled=false', async () => {
      await createMember({ phone: '01712340000' });
      tenantOtpEnabled.set(SEED_TENANT_ID, false);

      const result = await service.request('01712340000', context);

      expect(result).toEqual({});
      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(0);
    });

    it('deny wins: a user in tenant A(on) + tenant B(off) is refused', async () => {
      await createMember({ phone: '01712349999' }, [SEED_TENANT_ID, OTHER_TENANT]);
      tenantOtpEnabled.set(OTHER_TENANT, false);

      const result = await service.request('01712349999', context);

      expect(result).toEqual({});
      const logs = await dataSource.getRepository(CommunicationLog).find();
      expect(logs).toHaveLength(0);
    });

    it('signs in a passwordless user (password_hash IS NULL)', async () => {
      const user = await createMember({ phone: '01799999999', password_hash: null });
      expect(user.password_hash).toBeNull();

      const { debug } = await service.request('01799999999', context);
      const result = await service.verify('01799999999', debug!.otp!, context);

      expect(result.access_token).toBe('fake-access-token');
    });
  });

  describe('verify', () => {
    it('locks after 5 wrong attempts (429), and the right code after lock still 429s', async () => {
      const user = await createMember({ phone: '01711111111' });
      const { debug } = await service.request('01711111111', context);
      const rightOtp = debug!.otp!;

      for (let i = 0; i < 4; i++) {
        await expect(service.verify(user.phone!, '000000', context)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
      await expect(service.verify(user.phone!, '000000', context)).rejects.toMatchObject({
        status: 429,
      });
      await expect(service.verify(user.phone!, rightOtp, context)).rejects.toMatchObject({
        status: 429,
      });
    });

    it('verifies the right code, resets lockouts, audits LOGIN with method otp, and returns a LoginResponse-shaped session', async () => {
      const user = await createMember({ phone: '01722222222' });
      const { debug } = await service.request('01722222222', context);

      const result = await service.verify('01722222222', debug!.otp!, context);

      expect(fakeLoginAttempts.reset).toHaveBeenCalledWith('01722222222');
      expect(fakeAuthService.startSession).toHaveBeenCalledTimes(1);
      // Identical session shape to a password login: same top-level keys.
      expect(Object.keys(result).sort()).toEqual(
        ['access_token', 'memberships', 'refreshToken'].sort(),
      );

      const auditRows = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.LOGIN } });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].new_values).toEqual({ method: 'otp' });

      const updated = await dataSource
        .getRepository(User)
        .findOneOrFail({ where: { id: user.id } });
      expect(updated.last_login_at).not.toBeNull();
      // [12.7] A successful OTP verify proves phone ownership.
      expect(updated.phone_verified_at).not.toBeNull();
      const contactAudits = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.CONTACT_VERIFIED } });
      expect(contactAudits).toHaveLength(1);
      expect(contactAudits[0].new_values).toMatchObject({ field: 'phone', via: 'otp_login' });
    });

    it('[12.7] does not re-stamp or re-audit when the phone is already verified', async () => {
      const user = await createMember({ phone: '01744444444', phone_verified_at: new Date() });
      const { debug } = await service.request('01744444444', context);

      await service.verify('01744444444', debug!.otp!, context);

      const contactAudits = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.CONTACT_VERIFIED } });
      expect(contactAudits).toHaveLength(0);
    });

    /**
     * [12.7] The stamp is a compare-and-set on `phone`, so an admin edit
     * landing between the user lookup and the write cannot make the
     * REPLACEMENT number verified off the back of a code sent to the old one.
     *
     * `loginAttempts.reset` is called in exactly that window (after the
     * lookup, before the stamp), so driving the edit from its mock
     * reproduces the interleaving deterministically instead of racing it.
     */
    it('[12.7] does not verify a phone that was replaced mid-flight', async () => {
      const user = await createMember({ phone: '01745555555' });
      const { debug } = await service.request('01745555555', context);

      fakeLoginAttempts.reset.mockImplementationOnce(async () => {
        await dataSource
          .getRepository(User)
          .update({ id: user.id }, { phone: '01746666666', phone_verified_at: null });
      });

      await service.verify('01745555555', debug!.otp!, context);

      const updated = await dataSource
        .getRepository(User)
        .findOneOrFail({ where: { id: user.id } });
      // The replacement number is the one on the row now, and it is NOT
      // verified — nobody proved control of it.
      expect(updated.phone).toBe('01746666666');
      expect(updated.phone_verified_at).toBeNull();

      const contactAudits = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.CONTACT_VERIFIED } });
      expect(contactAudits).toHaveLength(0);
    });

    it('refuses a SUSPENDED user with the same 401 body as a bad code', async () => {
      const user = await createMember({ phone: '01733333333', status: UserStatus.SUSPENDED });
      // Request as ACTIVE first isn't possible since request() also gates on
      // ACTIVE; issue the OTP directly via OtpService semantics by activating,
      // requesting, then suspending — simpler: request while active.
      await dataSource.getRepository(User).update({ id: user.id }, { status: UserStatus.ACTIVE });
      const { debug } = await service.request('01733333333', context);
      await dataSource
        .getRepository(User)
        .update({ id: user.id }, { status: UserStatus.SUSPENDED });

      await expect(service.verify('01733333333', debug!.otp!, context)).rejects.toMatchObject({
        message: 'Invalid credentials',
      });
      await expect(service.verify('01733333333', '000000', context)).rejects.toMatchObject({
        message: 'Invalid credentials',
      });
    });

    it('deny wins on verify too: a user in tenant A(on) + tenant B(off) is refused even with the right code', async () => {
      const user = await createMember({ phone: '01744444444' }, [SEED_TENANT_ID]);
      const { debug } = await service.request('01744444444', context);
      // Add a second, OTP-disabled membership after the code was issued.
      const membershipRepo = dataSource.getRepository(UserTenant);
      await membershipRepo.save(
        membershipRepo.create({ user_id: user.id, tenant_id: OTHER_TENANT, role: 'PARENT' as any }),
      );
      tenantOtpEnabled.set(OTHER_TENANT, false);

      await expect(service.verify('01744444444', debug!.otp!, context)).rejects.toMatchObject({
        message: 'Invalid credentials',
      });
    });
  });
});
