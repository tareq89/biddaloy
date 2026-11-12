import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import {
  ApprovalScope,
  AuditAction,
  ImpersonationEndedBy,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { RecoveryService } from '../../account-access/recovery.service';
import { AuthTokenService } from '../../account-access/auth-token.service';
import { OtpService, OTP_REDIS } from '../../account-access/otp.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuthService } from '../../auth/auth.service';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { REFRESH_TOKEN_TTL_MS, RefreshTokenService } from '../../auth/refresh-token.service';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import { CommunicationProviderRegistryService } from '../../communications/providers/communication-provider.registry';
import { School } from '../../schools/entities/school.entity';
import { SchoolsService } from '../../schools/schools.service';
import { ImpersonationSessionService } from '../../support-access/sessions/impersonation-session.service';
import { User } from '../../users/entities/user.entity';
import { SchoolHelpService } from './school-help.service';

const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('SchoolHelpService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let service: SchoolHelpService;
  let recovery: RecoveryService;
  let redis: Redis;
  const provider = { send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p' }) };
  const sessions = { revokeAllForSchool: vi.fn().mockResolvedValue(0) };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    module = await createTestModule(ALL_ENTITIES, [
      SchoolHelpService,
      RecoveryService,
      AuthTokenService,
      SessionCutoffService,
      OtpService,
      AccountAccessDeliveryService,
      AuditService,
      RefreshTokenService,
      { provide: REFRESH_TOKEN_TTL_MS, useValue: 60_000 },
      { provide: OTP_REDIS, useValue: redis },
      { provide: ImpersonationSessionService, useValue: sessions },
      {
        provide: AuthService,
        useValue: {
          resetLoginLockouts: async () => undefined,
          primaryTenantId: async () => null,
          hasLiveMembership: async () => true,
          startSession: async () => ({}),
        },
      },
      {
        provide: SchoolsService,
        useFactory: (d: DataSource) => ({
          findById: async (id: string) => d.getRepository(School).findOneOrFail({ where: { id } }),
          getResolvedSettings: async () => ({ region: { locale: 'en-US' } }),
        }),
        inject: [DataSource],
      },
      { provide: CommunicationProviderRegistryService, useValue: { resolve: () => provider } },
      {
        provide: ConfigService,
        useValue: {
          get: (k: string) =>
            (
              ({
                APP_BASE_URL: 'http://localhost:5174',
                ACCOUNT_ACCESS_ECHO_SECRETS: 'true',
                JWT_SECRET: 'test-secret',
              }) as Record<string, string>
            )[k],
        },
      },
    ]);
    ds = module.get(DataSource);
    service = module.get(SchoolHelpService);
    recovery = module.get(RecoveryService);
  });

  afterAll(async () => {
    redis.disconnect();
    await module?.close();
  });

  const sfx = () => randomUUID().slice(0, 8);
  const school = (s = sfx()) =>
    ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${s}`, slug: `s-${s}` }));
  async function member(tenantId: string, role: UserRole, withEmail = true) {
    const s = sfx();
    const u = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        full_name: `P ${s}`,
        status: UserStatus.ACTIVE,
        email: withEmail ? `p-${s}@example.com` : null,
      }),
    );
    await ds.getRepository(UserTenant).save({ user_id: u.id, tenant_id: tenantId, role });
    return u;
  }
  const cutOffOf = async (id: string) =>
    (await ds.query('SELECT tokens_valid_after t FROM users WHERE id = $1', [id]))[0]
      .t as Date | null;
  const linkToken = () => {
    const sent = JSON.stringify(provider.send.mock.calls.at(-1));
    return decodeURIComponent(/reset-password\?token=([^"\\&\s]+)/.exec(sent)![1]);
  };
  const addRefresh = (userId: string) =>
    ds.getRepository(RefreshToken).save({
      user_id: userId,
      family_id: randomUUID(),
      token_hash: 'h'.repeat(64),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    } as never) as unknown as Promise<RefreshToken>;

  describe('reset link', () => {
    it('uses the real recovery path, audits with the tenant id, and the older link dies', async () => {
      const a = await school();
      const admin = await member(a.id, UserRole.ADMIN);
      const owner = await member(a.id, UserRole.ADMIN);

      await service.sendAdminResetLink(a.id, admin.id, owner.id, context);
      const oldToken = linkToken();
      expect(await cutOffOf(admin.id)).not.toBeNull(); // sessions cut by the recovery path
      await service.sendAdminResetLink(a.id, admin.id, owner.id, context);
      const newToken = linkToken();

      // A newer link voids the older one.
      await expect(
        recovery.reset({ new_password: 'A-new-strong-password1', token: oldToken }, context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await recovery.reset({ new_password: 'A-new-strong-password1', token: newToken }, context);

      const rows = await ds.getRepository(AuditLog).find({
        where: { entity_id: admin.id, action: AuditAction.PLATFORM_ADMIN_RESET_SENT },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].tenant_id).toBe(a.id);
      expect(rows[0].new_values).toMatchObject({
        approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
      });
    });

    it('a non-admin member, a user of another school and a stranger are all 404', async () => {
      const a = await school();
      const b = await school();
      const teacher = await member(a.id, UserRole.TEACHER);
      const otherAdmin = await member(b.id, UserRole.ADMIN);
      for (const id of [teacher.id, otherAdmin.id, randomUUID()]) {
        await expect(service.sendAdminResetLink(a.id, id, 'x', context)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      }
    });

    it('an admin who also belongs to another school is 409 SHARED_IDENTITY and no session is cut', async () => {
      const a = await school();
      const b = await school();
      const admin = await member(a.id, UserRole.ADMIN);
      await ds
        .getRepository(UserTenant)
        .save({ user_id: admin.id, tenant_id: b.id, role: UserRole.TEACHER });
      await expect(service.sendAdminResetLink(a.id, admin.id, 'x', context)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(await cutOffOf(admin.id)).toBeNull();
    });
  });

  describe('logout-all', () => {
    it('cuts the access cutoff and refresh tokens of members only, audits the count, ends Login as', async () => {
      const a = await school();
      const b = await school();
      const m1 = await member(a.id, UserRole.TEACHER);
      const m2 = await member(a.id, UserRole.ADMIN);
      // Two roles in the same school still count once.
      await ds
        .getRepository(UserTenant)
        .save({ user_id: m2.id, tenant_id: a.id, role: UserRole.TEACHER });
      const outsider = await member(b.id, UserRole.TEACHER);
      const rt = await addRefresh(m1.id);
      const outsiderRt = await addRefresh(outsider.id);

      const res = await service.logoutAll(a.id, m2.id, context);

      expect(res).toEqual({ usersSignedOut: 2 });
      expect(await cutOffOf(m1.id)).not.toBeNull(); // access token dies
      expect(await cutOffOf(m2.id)).not.toBeNull();
      expect(
        (await ds.getRepository(RefreshToken).findOneByOrFail({ id: rt.id })).revoked_at,
      ).not.toBeNull();
      // School B is untouched: not a member of A.
      expect(await cutOffOf(outsider.id)).toBeNull();
      expect(
        (await ds.getRepository(RefreshToken).findOneByOrFail({ id: outsiderRt.id })).revoked_at,
      ).toBeNull();
      expect(sessions.revokeAllForSchool).toHaveBeenCalledWith(a.id, ImpersonationEndedBy.OWNER);

      const [row] = await ds
        .getRepository(AuditLog)
        .find({ where: { entity_id: a.id, action: AuditAction.PLATFORM_SCHOOL_LOGOUT_ALL } });
      expect(row.tenant_id).toBe(a.id);
      expect(row.new_values).toMatchObject({ usersSignedOut: 2 });
    });

    it('a shared identity is cut off too and an unknown school is 404', async () => {
      const a = await school();
      const b = await school();
      const shared = await member(a.id, UserRole.TEACHER);
      await ds
        .getRepository(UserTenant)
        .save({ user_id: shared.id, tenant_id: b.id, role: UserRole.TEACHER });
      await service.logoutAll(a.id, shared.id, context);
      expect(await cutOffOf(shared.id)).not.toBeNull();
      await expect(service.logoutAll(randomUUID(), shared.id, context)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
