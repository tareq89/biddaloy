import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { AuditAction, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { ContactChangeService } from './contact-change.service';
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
import { SchoolsService } from '../schools/schools.service';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';

const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('ContactChangeService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: ContactChangeService;
  let redis: Redis;
  let fakeProvider: { send: ReturnType<typeof vi.fn> };
  let fakeAuthService: { primaryTenantId: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    fakeProvider = { send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }) };
    fakeAuthService = { primaryTenantId: vi.fn().mockResolvedValue(SEED_TENANT_ID) };

    module = await createTestModule(ALL_ENTITIES, [
      ContactChangeService,
      AuthTokenService,
      OtpService,
      AccountAccessDeliveryService,
      AuditService,
      { provide: OTP_REDIS, useValue: redis },
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
    service = module.get(ContactChangeService);
  });

  afterAll(async () => {
    await module.close();
    redis.disconnect();
  });

  beforeEach(async () => {
    fakeProvider.send.mockClear();
    await redis.flushdb();
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM communication_logs');
    await dataSource.query('DELETE FROM auth_tokens');
    await dataSource.query('DELETE FROM user_tenants');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM schools');

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school-cc' }),
    );
  });

  async function createMember(overrides: Partial<User> = {}) {
    const userRepo = dataSource.getRepository(User);
    const membershipRepo = dataSource.getRepository(UserTenant);
    const user = await userRepo.save(
      userRepo.create({
        full_name: 'Karim',
        status: UserStatus.ACTIVE,
        password_hash: await bcrypt.hash('correct-password', 4),
        phone: '+8801711111111',
        email: 'karim@example.com',
        ...overrides,
      }),
    );
    await membershipRepo.save(
      membershipRepo.create({
        user_id: user.id,
        tenant_id: SEED_TENANT_ID,
        role: 'TEACHER' as any,
      }),
    );
    return user;
  }

  it('requests a phone change: leaves users.phone unchanged and logs one SMS row', async () => {
    const user = await createMember();

    const result = await service.request(
      user.id,
      { phone: '+8801722222222', current_password: 'correct-password' },
      context,
    );

    expect(result.channel).toBe('otp');
    const reloaded = await dataSource.getRepository(User).findOneOrFail({ where: { id: user.id } });
    expect(reloaded.phone).toBe('+8801711111111');

    const logRepo = dataSource.getRepository(CommunicationLog);
    const logs = await logRepo.find({ where: { tenant_id: SEED_TENANT_ID } });
    expect(logs).toHaveLength(1);
    expect(logs[0].medium).toBe(CommunicationMedium.SMS);
  });

  it('confirms a phone change with the correct OTP: replaces phone, stamps verified, and audits', async () => {
    const user = await createMember();
    const result = await service.request(
      user.id,
      { phone: '+8801722222222', current_password: 'correct-password' },
      context,
    );
    const otp = (result as { debug?: { otp?: string } }).debug?.otp as string;
    expect(otp).toBeTruthy();

    await service.confirmPhone(user.id, otp, context);

    const reloaded = await dataSource.getRepository(User).findOneOrFail({ where: { id: user.id } });
    expect(reloaded.phone).toBe('+8801722222222');
    expect(reloaded.phone_verified_at).not.toBeNull();

    const auditRepo = dataSource.getRepository(AuditLog);
    const audits = await auditRepo.find({
      where: { entity_id: user.id, action: AuditAction.CONTACT_VERIFIED },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].new_values).toMatchObject({ field: 'phone', via: 'contact_change' });
  });

  it('wrong current_password: 403, phone untouched', async () => {
    const user = await createMember();
    await expect(
      service.request(user.id, { phone: '+8801722222222', current_password: 'nope' }, context),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const reloaded = await dataSource.getRepository(User).findOneOrFail({ where: { id: user.id } });
    expect(reloaded.phone).toBe('+8801711111111');
  });

  it('passwordless user: 400 no_password', async () => {
    const user = await createMember({ password_hash: null });
    await expect(
      service.request(user.id, { phone: '+8801722222222', current_password: 'anything' }, context),
    ).rejects.toThrow(BadRequestException);
  });

  it('duplicate phone at request time: 409', async () => {
    await createMember({ phone: '+8801733333333', email: 'other@example.com' });
    const user = await createMember();
    await expect(
      service.request(
        user.id,
        { phone: '+8801733333333', current_password: 'correct-password' },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('email link: confirms once, second use 400', async () => {
    const user = await createMember();
    const result = await service.request(
      user.id,
      { email: 'new-karim@example.com', current_password: 'correct-password' },
      context,
    );
    const token = (result as { debug?: { token?: string } }).debug?.token as string;
    expect(token).toBeTruthy();

    const first = await service.confirmEmail(token, context);
    expect(first.status).toBe('valid');

    const reloaded = await dataSource.getRepository(User).findOneOrFail({ where: { id: user.id } });
    expect(reloaded.email).toBe('new-karim@example.com');
    expect(reloaded.email_verified_at).not.toBeNull();

    const second = await service.confirmEmail(token, context);
    expect(second.status).toBe('consumed');
  });

  it('confirmPhone with no pending change: 404', async () => {
    const user = await createMember();
    // The exact type, not a bare `toThrow()` — the 404 contract is what the
    // client distinguishes "your pending change expired, start again" from
    // a 400 "that code is wrong".
    await expect(service.confirmPhone(user.id, '123456', context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // The DTO accepts surrounding whitespace and mixed case, but
  // `OtpLoginService.verify` looks users up by
  // `normalizeLoginIdentifier(phone)` — so a raw value written to
  // `users.phone` would be a number the owner could never sign in with.
  // Everything the request stores must already be normalized.
  it('stores the NORMALIZED phone, so OTP login can still find the row', async () => {
    const user = await createMember();

    const result = await service.request(
      user.id,
      { phone: '  +8801722222222  ', current_password: 'correct-password' },
      context,
    );
    const otp = (result as { debug?: { otp?: string } }).debug?.otp as string;
    await service.confirmPhone(user.id, otp, context);

    const reloaded = await dataSource.getRepository(User).findOneOrFail({ where: { id: user.id } });
    expect(reloaded.phone).toBe('+8801722222222');
  });

  // Same normalization, one step earlier: a padded duplicate must be caught
  // by the uniqueness pre-check (409) rather than slipping through to the
  // unique index at confirm time.
  it('catches a whitespace-padded duplicate at request time: 409', async () => {
    await createMember({ phone: '+8801733333333', email: 'other@example.com' });
    const user = await createMember();

    await expect(
      service.request(
        user.id,
        { phone: ' +8801733333333 ', current_password: 'correct-password' },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
