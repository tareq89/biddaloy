import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { ApprovalMode, ApprovalScope, AuditAction, UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { StepUpService, STEP_UP_REDIS } from './step-up.service';
import { StepUpVerifyDto } from './dto/step-up.dto';
import { OtpService, OTP_REDIS } from '../account-access/otp.service';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';

const OTHER_TENANT = '00000000-0000-4000-8000-000000000199';
const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('StepUpService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: StepUpService;
  let otpRedis: Redis;
  let stepUpRedis: Redis;
  let approvalMode: ApprovalMode;

  beforeAll(async () => {
    // Enables this ticket's own test-only shim (see step-up.service.ts) so
    // an ADMIN in the seed tenant can hold FEE_APPROVE — #645, running in
    // parallel, is the lane that lands the real permission into
    // ROLE_PERMISSIONS; this worktree doesn't have it yet.
    process.env.STEP_UP_TEST_ALLOW_ADMIN_APPROVE = 'true';

    otpRedis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    stepUpRedis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    approvalMode = ApprovalMode.OTP;

    module = await createTestModule(ALL_ENTITIES, [
      StepUpService,
      OtpService,
      AuditService,
      { provide: OTP_REDIS, useValue: otpRedis },
      { provide: STEP_UP_REDIS, useValue: stepUpRedis },
      { provide: JwtService, useValue: new JwtService({ secret: 'test-secret' }) },
      { provide: ConfigService, useValue: { get: () => undefined } },
      {
        provide: SchoolsService,
        useValue: {
          getResolvedSettings: async () => ({
            version: 1,
            fees: { approval_mode: approvalMode },
          }),
        },
      },
    ]);
    dataSource = module.get(DataSource);
    service = module.get(StepUpService);
  });

  afterAll(async () => {
    await module.close();
    otpRedis.disconnect();
    stepUpRedis.disconnect();
  });

  beforeEach(async () => {
    approvalMode = ApprovalMode.OTP;
    await otpRedis.flushdb();
    await stepUpRedis.flushdb();
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM user_tenants');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM schools');

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school-step-up' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school-step-up' }),
    );

    ACTOR_ID = (await createActor()).id;
  });

  async function createApprover(
    overrides: Partial<User> = {},
    tenantId: string = SEED_TENANT_ID,
    role: UserRole = UserRole.ADMIN,
  ) {
    const userRepo = dataSource.getRepository(User);
    const membershipRepo = dataSource.getRepository(UserTenant);
    const user = await userRepo.save(
      userRepo.create({
        full_name: 'Approver Admin',
        email: 'approver@example.com',
        status: UserStatus.ACTIVE,
        password_hash: null,
        ...overrides,
      }),
    );
    await membershipRepo.save(
      membershipRepo.create({ user_id: user.id, tenant_id: tenantId, role }),
    );
    return user;
  }

  // audit_logs.performed_by_user_id FKs to users(id), so the actor needs a
  // real row too — created fresh per test in beforeEach via createActor().
  let ACTOR_ID: string;

  async function createActor(tenantId: string = SEED_TENANT_ID) {
    const userRepo = dataSource.getRepository(User);
    const membershipRepo = dataSource.getRepository(UserTenant);
    const actor = await userRepo.save(
      userRepo.create({
        full_name: 'Acting Accountant',
        email: 'actor@example.com',
        status: UserStatus.ACTIVE,
        password_hash: null,
      }),
    );
    await membershipRepo.save(
      membershipRepo.create({ user_id: actor.id, tenant_id: tenantId, role: UserRole.ACCOUNTANT }),
    );
    return actor;
  }

  function verifyDto(overrides: Partial<StepUpVerifyDto> = {}): StepUpVerifyDto {
    return {
      identifier: 'approver@example.com',
      method: 'OTP',
      otp: '000000',
      scope: ApprovalScope.FEES_DUPLICATE_OVERRIDE,
      ...overrides,
    };
  }

  it('stores the single-use approval:{jti} Redis key with a TTL <= 300s', async () => {
    await createApprover();

    // requestOtp() (the 202 endpoint) doesn't echo the code back — that's
    // account-access-echo.ts's job for the account-access module's own
    // routes, out of this ticket's scope. Mint a code the same way
    // requestOtp() does internally (same OtpService, same purpose +
    // identifier) so verify() below can consume it.
    const otpService = module.get(OtpService);
    const { code } = await otpService.request('STEP_UP' as any, 'approver@example.com');

    const result = await service.verify(
      verifyDto({ otp: code }),
      ACTOR_ID,
      SEED_TENANT_ID,
      context,
    );

    const jti = result.approval_token
      ? (JSON.parse(Buffer.from(result.approval_token.split('.')[1], 'base64').toString())
          .jti as string)
      : '';
    expect(jti).toBeTruthy();

    const ttl = await stepUpRedis.pttl(`approval:${jti}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300_000);
    expect(await stepUpRedis.get(`approval:${jti}`)).toBe('1');
  });

  it('audits success with CREATE / entity_type User and the scope/approver/actor', async () => {
    const approver = await createApprover();
    const otpService = module.get(OtpService);
    const { code } = await otpService.request('STEP_UP' as any, 'approver@example.com');

    await service.verify(verifyDto({ otp: code }), ACTOR_ID, SEED_TENANT_ID, context);

    const rows = await dataSource
      .getRepository(AuditLog)
      .find({ where: { entity_id: approver.id, action: AuditAction.CREATE } });
    expect(rows).toHaveLength(1);
    expect(rows[0].new_values).toEqual({
      scope: ApprovalScope.FEES_DUPLICATE_OVERRIDE,
      approver_id: approver.id,
      actor_id: ACTOR_ID,
    });
  });

  it('rejects an approver who belongs only to a different tenant', async () => {
    await createApprover({}, OTHER_TENANT);

    await expect(
      service.verify(verifyDto(), ACTOR_ID, SEED_TENANT_ID, context),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('the 6th failed OTP attempt for the same approver identifier 429s', async () => {
    await createApprover();

    for (let i = 0; i < 5; i++) {
      await expect(
        service.verify(verifyDto({ otp: '999999' }), ACTOR_ID, SEED_TENANT_ID, context),
      ).rejects.toBeInstanceOf(HttpException);
    }

    await expect(
      service.verify(verifyDto({ otp: '999999' }), ACTOR_ID, SEED_TENANT_ID, context),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('every failed attempt is audited as LOGIN_FAILED without the raw OTP', async () => {
    await createApprover();

    await service
      .verify(verifyDto({ otp: '999999' }), ACTOR_ID, SEED_TENANT_ID, context)
      .catch(() => undefined);

    const rows = await dataSource
      .getRepository(AuditLog)
      .find({ where: { action: AuditAction.LOGIN_FAILED } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].new_values)).not.toContain('999999');
  });

  it('PASSWORD is rejected with 400 PASSWORD_NOT_ALLOWED unless approval_mode is OTP_OR_PASSWORD', async () => {
    await createApprover();
    approvalMode = ApprovalMode.OTP;

    await expect(
      service.verify(
        {
          identifier: 'approver@example.com',
          method: 'PASSWORD',
          password: 'x',
          scope: ApprovalScope.FEES_EDIT_PAID,
        },
        ACTOR_ID,
        SEED_TENANT_ID,
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
