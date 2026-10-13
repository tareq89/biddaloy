import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  UserStatus,
} from '@biddaloy/shared';
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
import { RefreshTokenService } from '../auth/refresh-token.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { SchoolsService } from '../schools/schools.service';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';

const context = { ip: '127.0.0.1', userAgent: 'vitest' };
/** The platform tenant: a SUPER_ADMIN row here is platform authority (`isPlatformSuperAdmin`). */
const PLATFORM_SCHOOL = '00000000-0000-4000-8000-0000000007f0';

describe('ContactChangeService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: ContactChangeService;
  let redis: Redis;
  let fakeProvider: { send: ReturnType<typeof vi.fn> };
  const fakeRefreshTokens = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
  let fakeAuthService: {
    primaryTenantId: ReturnType<typeof vi.fn>;
    hasLiveMembership: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    fakeProvider = { send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }) };
    fakeAuthService = {
      primaryTenantId: vi.fn().mockResolvedValue(SEED_TENANT_ID),
      hasLiveMembership: vi.fn().mockResolvedValue(true),
    };

    module = await createTestModule(ALL_ENTITIES, [
      ContactChangeService,
      AuthTokenService,
      OtpService,
      AccountAccessDeliveryService,
      AuditService,
      SessionCutoffService,
      { provide: RefreshTokenService, useValue: fakeRefreshTokens },
      { provide: TenantStatusService, useValue: { platformTenantId: async () => PLATFORM_SCHOOL } },
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

  // Money (F5): a user in no school would otherwise get platform-paid
  // SMS/email to an address they choose. Refuse before anything is sent.
  it('user with no school membership: 403 no_school, nothing sent', async () => {
    const user = await createMember();
    fakeAuthService.hasLiveMembership.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(
      service.request(
        user.id,
        { phone: '+8801722222222', current_password: 'correct-password' },
        context,
      ),
    ).rejects.toThrow(new ForbiddenException('no_school'));
    await expect(
      service.request(
        user.id,
        { email: 'new@example.com', current_password: 'correct-password' },
        context,
      ),
    ).rejects.toThrow(new ForbiddenException('no_school'));
    expect(fakeProvider.send).not.toHaveBeenCalled();
    expect(await dataSource.getRepository(CommunicationLog).count()).toBe(0);
    expect(await dataSource.query('SELECT 1 FROM auth_tokens')).toHaveLength(0);
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
  describe('[75.1] proposeByAdmin / approval', () => {
    const OTHER_SCHOOL = '00000000-0000-4000-8000-0000000007a1';
    const NEW_PHONE = '+8801799990001';

    /** The person (TEACHER in the seed school) also belongs to OTHER_SCHOOL, whose ADMIN is returned. */
    async function sharedSetup(overrides: Partial<User> = {}) {
      const user = await createMember({ email_verified_at: new Date(), ...overrides });
      const schoolRepo = dataSource.getRepository(School);
      await schoolRepo.save(
        schoolRepo.create({ id: OTHER_SCHOOL, name: 'Other School', slug: 'other-school-cc' }),
      );
      const userRepo = dataSource.getRepository(User);
      const admin = await userRepo.save(
        userRepo.create({
          full_name: 'Other Admin',
          status: UserStatus.ACTIVE,
          email: 'other-admin@example.com',
        }),
      );
      const membershipRepo = dataSource.getRepository(UserTenant);
      await membershipRepo.save(
        membershipRepo.create({
          user_id: user.id,
          tenant_id: OTHER_SCHOOL,
          role: 'TEACHER' as any,
        }),
      );
      await membershipRepo.save(
        membershipRepo.create({ user_id: admin.id, tenant_id: OTHER_SCHOOL, role: 'ADMIN' as any }),
      );
      // The seed school's admin is the one who proposes (approval re-checks they still are one).
      const proposer = await userRepo.save(
        userRepo.create({
          full_name: 'Proposing Admin',
          status: UserStatus.ACTIVE,
          email: 'proposing-admin@example.com',
        }),
      );
      await membershipRepo.save(
        membershipRepo.create({
          user_id: proposer.id,
          tenant_id: SEED_TENANT_ID,
          role: 'ADMIN' as any,
        }),
      );
      proposerId = proposer.id;
      return { user, admin, proposer };
    }
    let proposerId: string;

    const propose = (userId: string, extra: { email?: string | null; phone?: string | null }) =>
      service.proposeByAdmin(
        { userId, tenantId: SEED_TENANT_ID, actorUserId: proposerId, ...extra },
        context,
      );
    const liveTokens = async (userId: string) =>
      Number(
        (
          await dataSource.query(
            `SELECT count(*) n FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
            [userId],
          )
        )[0].n,
      );
    const linkIn = (body: string) => decodeURIComponent(/token=([^\s&]+)/.exec(body)![1]);

    const sentTo = () =>
      fakeProvider.send.mock.calls.map((c) => c[0] as { to: string; body: string });

    it('sends the link to the CURRENT verified email, never to the proposed address', async () => {
      const { user } = await sharedSetup();

      await propose(user.id, { phone: NEW_PHONE });

      const approval = sentTo().find((m) => m.to === 'karim@example.com');
      expect(approval?.body).toContain('/verify-email?token=');
      expect(sentTo().some((m) => m.to === NEW_PHONE)).toBe(false);
      // Nothing is written to the user yet.
      const reloaded = await dataSource
        .getRepository(User)
        .findOneOrFail({ where: { id: user.id } });
      expect(reloaded.phone).toBe('+8801711111111');
    });

    it('with no email or phone on file: NO_CONTACT 409 and nothing sent', async () => {
      const { user } = await sharedSetup({ email: null, phone: null });

      await expect(propose(user.id, { email: 'new@example.com' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(fakeProvider.send).not.toHaveBeenCalled();
    });

    it("notifies the other school's ADMIN; the notice does not contain the new value", async () => {
      const { user } = await sharedSetup();

      await propose(user.id, { phone: NEW_PHONE });

      const notice = sentTo().find((m) => m.to === 'other-admin@example.com');
      expect(notice).toBeDefined();
      expect(notice?.body).toContain('Test School');
      expect(notice?.body).not.toContain(NEW_PHONE);
      const stored = await dataSource.getRepository(CommunicationLog).find();
      expect(stored.some((l) => l.message_body.includes(NEW_PHONE))).toBe(false);
    });

    it('rejects a phone already used by someone else: 409, nothing sent', async () => {
      const { user } = await sharedSetup();
      await createMember({ phone: NEW_PHONE, email: 'taken@example.com' });

      await expect(propose(user.id, { phone: NEW_PHONE })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(fakeProvider.send).not.toHaveBeenCalled();
    });

    // D23 (review M1): approval is consent; the change applies only once the NEW contact proves
    // it is theirs with a code. Until then the old value stays the login.
    it('approve sends a code to the NEW phone and changes nothing; the right code applies it verified', async () => {
      const { user } = await sharedSetup({ phone_verified_at: new Date() });
      await propose(user.id, { phone: NEW_PHONE });
      const token = linkIn(sentTo()[0].body);

      // Opening the link changes nothing: it shows the proposal, values masked.
      const preview = await service.confirmEmail(token, context);
      expect(preview).toEqual({
        status: 'proposal',
        proposal: { from_school: 'Test School', new_phone: '+88017••••001' },
      });
      fakeProvider.send.mockClear();

      const asked = await service.confirmEmail(token, context, 'approve');

      expect(asked.status).toBe('confirm');
      expect(sentTo().map((m) => m.to)).toEqual([NEW_PHONE]);
      const code = asked.debug!.phone_code!;
      expect(sentTo()[0].body).toContain(code);
      const [untouched] = await dataSource.query(
        'SELECT phone, tokens_valid_after FROM users WHERE id = $1',
        [user.id],
      );
      expect(untouched.phone).toBe('+8801711111111');
      expect(untouched.tokens_valid_after).toBeNull();
      expect(await liveTokens(user.id)).toBe(1);

      // A wrong code changes nothing either.
      const wrong = code === '000000' ? '111111' : '000000';
      await expect(
        service.confirmEmail(token, context, 'approve', { phone_code: wrong }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const asked2 = await (async () => {
        await redis.flushdb(); // skip the 60 s resend cooldown
        return service.confirmEmail(token, context, 'approve');
      })();
      const cutOff = vi.spyOn(module.get(SessionCutoffService), 'cutOff');
      const result = await service.confirmEmail(token, context, 'approve', {
        phone_code: asked2.debug!.phone_code,
      });

      expect(result).toEqual({ status: 'valid' });
      // Review m1: refresh tokens are revoked before the cut-off is stamped.
      expect(fakeRefreshTokens.revokeAllForUser.mock.invocationCallOrder[0]).toBeLessThan(
        cutOff.mock.invocationCallOrder[0],
      );
      cutOff.mockRestore();
      const [row] = await dataSource.query(
        'SELECT phone, phone_verified_at, email, tokens_valid_after FROM users WHERE id = $1',
        [user.id],
      );
      expect(row.phone).toBe(NEW_PHONE);
      expect(row.phone_verified_at).not.toBeNull();
      expect(row.email).toBe('karim@example.com');
      expect(row.tokens_valid_after).not.toBeNull();
      expect(fakeRefreshTokens.revokeAllForUser).toHaveBeenCalledWith(user.id);
      expect(await liveTokens(user.id)).toBe(0);
      const audits = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_id: user.id, action: AuditAction.CONTACT_VERIFIED } });
      expect(audits[0].new_values).toMatchObject({ via: 'admin_proposal', new_phone: NEW_PHONE });
    });

    it('an email proposal is confirmed with a code sent to the NEW address', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { email: 'karim.new@example.com' });
      const token = linkIn(sentTo()[0].body);
      fakeProvider.send.mockClear();

      const asked = await service.confirmEmail(token, context, 'approve');
      expect(sentTo().map((m) => m.to)).toEqual(['karim.new@example.com']);
      const [before] = await dataSource.query('SELECT email FROM users WHERE id = $1', [user.id]);
      expect(before.email).toBe('karim@example.com');

      const result = await service.confirmEmail(token, context, 'approve', {
        email_code: asked.debug!.email_code,
      });

      expect(result.status).toBe('valid');
      const [row] = await dataSource.query(
        'SELECT email, email_verified_at FROM users WHERE id = $1',
        [user.id],
      );
      expect(row.email).toBe('karim.new@example.com');
      expect(row.email_verified_at).not.toBeNull();
    });

    // Review n-new-1: proposal codes have their own OTP purpose, apart from self-service PHONE_VERIFY.
    it("someone's self-service request to the same number neither blocks nor replaces the proposal code", async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = linkIn(sentTo()[0].body);
      const { debug } = await service.confirmEmail(token, context, 'approve');
      const other = await createMember({ phone: '+8801722222222', email: 'other@example.com' });

      await expect(
        service.request(
          other.id,
          { phone: NEW_PHONE, current_password: 'correct-password' },
          context,
        ),
      ).resolves.toMatchObject({ channel: 'otp' });

      const result = await service.confirmEmail(token, context, 'approve', {
        phone_code: debug!.phone_code,
      });
      expect(result.status).toBe('valid');
    });

    it('a code sent for one proposal does not confirm another value', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = linkIn(sentTo()[0].body);
      const asked = await service.confirmEmail(token, context, 'approve');
      // The school replaces its proposal: the old link is revoked, so its code is useless.
      await propose(user.id, { phone: '+8801799990002' });

      expect(
        (
          await service.confirmEmail(token, context, 'approve', {
            phone_code: asked.debug!.phone_code,
          })
        ).status,
      ).toBe('revoked');
      const [row] = await dataSource.query('SELECT phone FROM users WHERE id = $1', [user.id]);
      expect(row.phone).toBe('+8801711111111');
    });

    it('a second proposal revokes the first link', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const first = /token=([^\s&]+)/.exec(sentTo()[0].body)![1];
      await propose(user.id, { phone: '+8801799990002' });

      const result = await service.confirmEmail(decodeURIComponent(first), context);

      expect(result).toEqual({ status: 'revoked' });
    });
    it('the approval message shows the MASKED new value, never the full one', async () => {
      const { user } = await sharedSetup();

      await propose(user.id, { phone: NEW_PHONE });

      const approval = sentTo().find((m) => m.to === 'karim@example.com')!;
      expect(approval.body).toContain('+88017••••001');
      expect(approval.body).not.toContain(NEW_PHONE);
    });

    it('decline cancels the proposal and tells the asking school; nothing changes', async () => {
      const { user } = await sharedSetup();
      const userRepo = dataSource.getRepository(User);
      const askingAdmin = await userRepo.save(
        userRepo.create({
          full_name: 'Asking Admin',
          status: UserStatus.ACTIVE,
          email: 'asking-admin@example.com',
        }),
      );
      const membershipRepo = dataSource.getRepository(UserTenant);
      await membershipRepo.save(
        membershipRepo.create({
          user_id: askingAdmin.id,
          tenant_id: SEED_TENANT_ID,
          role: 'ADMIN' as any,
        }),
      );
      await propose(user.id, { phone: NEW_PHONE });
      const token = decodeURIComponent(/token=([^\s&]+)/.exec(sentTo()[0].body)![1]);
      fakeProvider.send.mockClear();

      const result = await service.confirmEmail(token, context, 'decline');

      expect(result).toEqual({ status: 'declined' });
      expect(sentTo().some((m) => m.to === 'asking-admin@example.com')).toBe(true);
      const [row] = await dataSource.query('SELECT phone FROM users WHERE id = $1', [user.id]);
      expect(row.phone).toBe('+8801711111111');
      // The link is spent: approving afterwards does nothing.
      expect((await service.confirmEmail(token, context, 'approve')).status).toBe('consumed');
    });

    it('approval: a value taken meanwhile (unique violation) is a 409 and the link stays usable', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = decodeURIComponent(/token=([^\s&]+)/.exec(sentTo()[0].body)![1]);
      const { debug } = await service.confirmEmail(token, context, 'approve');
      // Another user claims the value between the check and the write.
      const update = vi.spyOn(Repository.prototype, 'update').mockRejectedValueOnce(
        Object.assign(new QueryFailedError('UPDATE users', [], new Error('dup')), {
          code: '23505',
        }),
      );

      await expect(
        service.confirmEmail(token, context, 'approve', { phone_code: debug!.phone_code }),
      ).rejects.toBeInstanceOf(ConflictException);
      update.mockRestore();

      const [{ n }] = await dataSource.query(
        `SELECT count(*) n FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [user.id],
      );
      expect(Number(n)).toBe(1);
    });

    it('assertCanPropose: NO_CONTACT and taken values are rejected with no side effects', async () => {
      const { user } = await sharedSetup({ email: null, phone: null });
      await expect(service.assertCanPropose(user.id, 'x@example.com', undefined)).rejects.toThrow(
        'approve the change',
      );
      expect(fakeProvider.send).not.toHaveBeenCalled();
      const [{ n }] = await dataSource.query(
        'SELECT count(*) n FROM auth_tokens WHERE user_id = $1',
        [user.id],
      );
      expect(Number(n)).toBe(0);
    });

    it('stale: once the contact the link went to has changed, the link is refused', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = decodeURIComponent(/token=([^\s&]+)/.exec(sentTo()[0].body)![1]);
      await dataSource.query('UPDATE users SET email = $2 WHERE id = $1', [
        user.id,
        'new-owner@example.com',
      ]);

      expect((await service.confirmEmail(token, context)).status).toBe('revoked');
      expect((await service.confirmEmail(token, context, 'approve')).status).toBe('revoked');
      const [row] = await dataSource.query('SELECT phone FROM users WHERE id = $1', [user.id]);
      expect(row.phone).toBe('+8801711111111');
    });

    it('two schools propose email=null and phone=null: the second approval is refused, link kept', async () => {
      // Phone verified, email not: both links go to the phone, which stays current until B clears it.
      const { user, admin, proposer } = await sharedSetup({
        email_verified_at: null,
        phone_verified_at: new Date(),
      });
      const proposeFrom = (tenantId: string, extra: { email?: null; phone?: null }) =>
        service.proposeByAdmin(
          {
            userId: user.id,
            tenantId,
            actorUserId: tenantId === OTHER_SCHOOL ? admin.id : proposer.id,
            ...extra,
          },
          context,
        );
      await proposeFrom(SEED_TENANT_ID, { email: null });
      const first = decodeURIComponent(/token=([^\s&]+)/.exec(sentTo()[0].body)![1]);
      await proposeFrom(OTHER_SCHOOL, { phone: null });
      const second = decodeURIComponent(
        /token=([^\s&]+)/.exec(sentTo().filter((m) => m.body.includes('token='))[1].body)![1],
      );

      expect((await service.confirmEmail(first, context, 'approve')).status).toBe('valid');
      await expect(service.confirmEmail(second, context, 'approve')).rejects.toBeInstanceOf(
        ConflictException,
      );

      const [row] = await dataSource.query('SELECT email, phone FROM users WHERE id = $1', [
        user.id,
      ]);
      expect(row.email).toBeNull();
      expect(row.phone).toBe('+8801711111111');
      // The refusal rolled back: the second link is not burned.
      const [{ n }] = await dataSource.query(
        `SELECT count(*) n FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [user.id],
      );
      expect(Number(n)).toBe(1);
    });

    it("a school's proposal and the person's own email change do not cancel each other", async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      await service.request(
        user.id,
        { email: 'mine@example.com', current_password: 'correct-password' },
        context,
      );
      const [{ n }] = await dataSource.query(
        `SELECT count(*) n FROM auth_tokens WHERE user_id = $1 AND purpose = 'EMAIL_VERIFY' AND revoked_at IS NULL`,
        [user.id],
      );
      expect(Number(n)).toBe(2);
    });

    // Review m2: re-saving the form with the same pending value must not re-send anything.
    it('re-proposing the identical change keeps the live link and sends nothing', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const first = linkIn(sentTo()[0].body);
      fakeProvider.send.mockClear();

      await propose(user.id, { phone: NEW_PHONE });

      expect(fakeProvider.send).not.toHaveBeenCalled();
      expect(await liveTokens(user.id)).toBe(1);
      expect((await service.confirmEmail(first, context)).status).toBe('proposal');
    });

    // Review m-new-5: the dedupe matches the proposer too, so the link always names an admin who asked.
    it('the same change re-saved by a different admin gets a fresh link and the old one is revoked', async () => {
      const { user, proposer } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const first = linkIn(sentTo()[0].body);
      const userRepo = dataSource.getRepository(User);
      const second = await userRepo.save(
        userRepo.create({ full_name: 'Second Admin', status: UserStatus.ACTIVE }),
      );
      await dataSource.getRepository(UserTenant).save(
        dataSource.getRepository(UserTenant).create({
          user_id: second.id,
          tenant_id: SEED_TENANT_ID,
          role: 'ADMIN' as any,
        }),
      );
      fakeProvider.send.mockClear();

      await service.proposeByAdmin(
        { userId: user.id, tenantId: SEED_TENANT_ID, actorUserId: second.id, phone: NEW_PHONE },
        context,
      );

      const fresh = linkIn(sentTo().find((m) => m.body.includes('token='))!.body);
      expect((await service.confirmEmail(first, context)).status).toBe('revoked');
      // The first admin is demoted: the second admin's link is still backed.
      await dataSource.query(`UPDATE user_tenants SET role = 'TEACHER' WHERE user_id = $1`, [
        proposer.id,
      ]);
      expect((await service.confirmEmail(fresh, context, 'approve')).status).toBe('confirm');
    });

    // Review m7/R1: deliver() reports a gateway outage as a FAILED result (it never throws), so that
    // is the shape that must revoke the link and answer 503.
    it('if the approval link is not delivered, the new link is revoked and the caller gets a clean 503', async () => {
      const { user } = await sharedSetup();
      const deliver = vi
        .spyOn(module.get(AccountAccessDeliveryService), 'deliver')
        .mockResolvedValueOnce({ logId: null, status: CommunicationStatus.FAILED });

      await expect(propose(user.id, { phone: NEW_PHONE })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      deliver.mockRestore();
      expect(await liveTokens(user.id)).toBe(0);

      // A retry is not mistaken for a duplicate: it issues and sends a fresh link.
      await propose(user.id, { phone: NEW_PHONE });
      expect(await liveTokens(user.id)).toBe(1);
      expect(sentTo().some((m) => m.body.includes('token='))).toBe(true);
    });

    it('if sending throws, the new link is revoked and the caller gets a clean 503', async () => {
      const { user } = await sharedSetup();
      const deliver = vi
        .spyOn(module.get(AccountAccessDeliveryService), 'deliver')
        .mockRejectedValueOnce(new Error('db down'));

      await expect(propose(user.id, { phone: NEW_PHONE })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      deliver.mockRestore();
      expect(await liveTokens(user.id)).toBe(0);
    });

    it('a live link that was never delivered is not a duplicate: a re-save sends a fresh one', async () => {
      const { user } = await sharedSetup();
      const deliver = vi
        .spyOn(module.get(AccountAccessDeliveryService), 'deliver')
        .mockResolvedValueOnce({ logId: null, status: CommunicationStatus.FAILED });
      // The clean-up revoke fails too, so the undelivered link stays live.
      const revoke = vi
        .spyOn(module.get(AuthTokenService), 'revoke')
        .mockRejectedValueOnce(new Error('db down'));

      // Review n-new-2: still the clean 503, and both failures are logged.
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      await expect(propose(user.id, { phone: NEW_PHONE })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('approval link not delivered'));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be revoked'));
      warn.mockRestore();
      error.mockRestore();
      deliver.mockRestore();
      revoke.mockRestore();
      expect(await liveTokens(user.id)).toBe(1);
      fakeProvider.send.mockClear();

      await propose(user.id, { phone: NEW_PHONE });

      expect(sentTo().some((m) => m.body.includes('token='))).toBe(true);
      expect(await liveTokens(user.id)).toBe(1);
    });

    it('a code that could not be sent to the new contact is a 503, not confirm; the link stays', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = linkIn(sentTo()[0].body);
      fakeProvider.send.mockResolvedValueOnce({ success: false });

      await expect(service.confirmEmail(token, context, 'approve')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(await liveTokens(user.id)).toBe(1);
    });

    // Review m8: the proposing school must still have the person, and the proposer must still be its admin.
    it('approval after the asking school removed the person: 409, the link is revoked, nothing changes', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = linkIn(sentTo()[0].body);
      await dataSource.query(
        'UPDATE user_tenants SET deleted_at = NOW() WHERE user_id = $1 AND tenant_id = $2',
        [user.id, SEED_TENANT_ID],
      );

      await expect(service.confirmEmail(token, context, 'approve')).rejects.toMatchObject({
        status: 409,
        response: { details: { code: 'PROPOSAL_WITHDRAWN' } },
      });
      expect((await service.confirmEmail(token, context)).status).toBe('revoked');
      const [row] = await dataSource.query('SELECT phone FROM users WHERE id = $1', [user.id]);
      expect(row.phone).toBe('+8801711111111');
    });

    // Review n-new-3: a removal that commits while the approval is running must be seen, not missed.
    it('a removal mid-approval is waited for and refuses the change', async () => {
      const { user } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = linkIn(sentTo()[0].body);
      const { debug } = await service.confirmEmail(token, context, 'approve');
      const removal = dataSource.createQueryRunner();
      await removal.connect();
      await removal.startTransaction();
      await removal.query(
        'UPDATE user_tenants SET deleted_at = NOW() WHERE user_id = $1 AND tenant_id = $2',
        [user.id, SEED_TENANT_ID],
      );

      const approval = service.confirmEmail(token, context, 'approve', {
        phone_code: debug!.phone_code,
      });
      const settled = approval.then(
        () => 'resolved',
        () => 'rejected',
      );
      await new Promise((r) => setTimeout(r, 300));
      await removal.commitTransaction();
      await removal.release();

      expect(await settled).toBe('rejected');
      await expect(approval).rejects.toMatchObject({
        response: { details: { code: 'PROPOSAL_WITHDRAWN' } },
      });
      const [row] = await dataSource.query('SELECT phone FROM users WHERE id = $1', [user.id]);
      expect(row.phone).toBe('+8801711111111');
    });

    it('approval after the proposer stopped being an admin there: 409 and the link is revoked', async () => {
      const { user, proposer } = await sharedSetup();
      await propose(user.id, { phone: NEW_PHONE });
      const token = linkIn(sentTo()[0].body);
      await dataSource.query(`UPDATE user_tenants SET role = 'TEACHER' WHERE user_id = $1`, [
        proposer.id,
      ]);

      await expect(service.confirmEmail(token, context, 'approve')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect((await service.confirmEmail(token, context)).status).toBe('revoked');
    });

    // Review m-new-1: PATCH /users/:id is open to a platform SUPER_ADMIN, who has no ADMIN row there.
    it('a proposal by a platform SUPER_ADMIN can be approved; a school-local SUPER_ADMIN cannot', async () => {
      const { user } = await sharedSetup();
      const schoolRepo = dataSource.getRepository(School);
      await schoolRepo.save(
        schoolRepo.create({ id: PLATFORM_SCHOOL, name: 'Platform', slug: 'platform-cc' }),
      );
      const userRepo = dataSource.getRepository(User);
      const membershipRepo = dataSource.getRepository(UserTenant);
      const platformAdmin = await userRepo.save(
        userRepo.create({ full_name: 'Platform Admin', status: UserStatus.ACTIVE }),
      );
      await membershipRepo.save(
        membershipRepo.create({
          user_id: platformAdmin.id,
          tenant_id: PLATFORM_SCHOOL,
          role: 'SUPER_ADMIN' as any,
        }),
      );
      const localSuper = await userRepo.save(
        userRepo.create({ full_name: 'Legacy Local Super', status: UserStatus.ACTIVE }),
      );
      await membershipRepo.save(
        membershipRepo.create({
          user_id: localSuper.id,
          tenant_id: SEED_TENANT_ID,
          role: 'SUPER_ADMIN' as any,
        }),
      );
      const proposeAs = (actorUserId: string, phone: string) =>
        service.proposeByAdmin(
          { userId: user.id, tenantId: SEED_TENANT_ID, actorUserId, phone },
          context,
        );
      const lastLink = () =>
        linkIn(
          sentTo()
            .filter((m) => m.body.includes('token='))
            .at(-1)!.body,
        );

      await proposeAs(platformAdmin.id, NEW_PHONE);
      expect((await service.confirmEmail(lastLink(), context, 'approve')).status).toBe('confirm');

      await proposeAs(localSuper.id, '+8801799990002');
      await expect(service.confirmEmail(lastLink(), context, 'approve')).rejects.toMatchObject({
        response: { details: { code: 'PROPOSAL_WITHDRAWN' } },
      });
    });

    it('notices skip the person themselves and inactive admins', async () => {
      const { user, admin } = await sharedSetup();
      await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [admin.id]);
      const membershipRepo = dataSource.getRepository(UserTenant);
      await membershipRepo.save(
        membershipRepo.create({ user_id: user.id, tenant_id: OTHER_SCHOOL, role: 'ADMIN' as any }),
      );

      await propose(user.id, { phone: NEW_PHONE });

      // Only the approval link went out: the one other admin is inactive, the person is excluded.
      expect(sentTo()).toHaveLength(1);
    });
  });
});
