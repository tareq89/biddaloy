import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ApprovalMode, ApprovalScope, AuditAction, UserRole, UserStatus } from '@biddaloy/shared';

// Mock bcrypt as a module-level replacement — same shape as auth.service.spec.ts.
vi.mock('bcrypt', () => {
  const mockCompare = vi.fn();
  const mockHash = vi.fn();
  return {
    default: { compare: mockCompare, hash: mockHash },
    compare: mockCompare,
    hash: mockHash,
  };
});

import bcrypt from 'bcrypt';
import { StepUpService, approverHoldsFeeApprove } from './step-up.service';
import { StepUpVerifyDto } from './dto/step-up.dto';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    incr: vi.fn(async (key: string) => {
      const next = (Number(store.get(key)) || 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    pexpire: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

function fakeRepo<T extends { id: string }>(rows: T[]) {
  return {
    findOne: vi.fn(async ({ where }: any) => {
      const conditions = Array.isArray(where) ? where : [where];
      return (
        rows.find((row) =>
          conditions.some((cond: Record<string, unknown>) =>
            Object.entries(cond).every(([k, v]) => (row as any)[k] === v),
          ),
        ) ?? null
      );
    }),
  };
}

const APPROVER = {
  id: 'approver-1',
  email: 'admin@example.com',
  phone: null,
  status: UserStatus.ACTIVE,
  full_name: 'Admin One',
  password_hash: '$2b$10$hashedpasswordvalueforadminone',
};

const MEMBERSHIP = { user_id: 'approver-1', tenant_id: 'tenant-1', role: UserRole.ADMIN };

const ACTOR_USER_ID = 'actor-1';
const TENANT_ID = 'tenant-1';
const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest' };

function buildService(
  overrides: Partial<{ otpService: any; schoolsService: any; membership: any }> = {},
) {
  const userRepo = fakeRepo([APPROVER as any]);
  const userTenantRepo = fakeRepo([overrides.membership ?? MEMBERSHIP] as any);
  const otpService = overrides.otpService ?? {
    request: vi.fn().mockResolvedValue({ code: '123456' }),
    verify: vi.fn().mockResolvedValue('ok'),
  };
  const auditService = { record: vi.fn().mockResolvedValue(undefined) };
  const jwtService = { sign: vi.fn().mockReturnValue('signed.jwt.token') };
  const schoolsService = overrides.schoolsService ?? {
    getResolvedSettings: vi.fn().mockResolvedValue({ version: 1 }),
  };
  const redis = fakeRedis();
  const config = { get: vi.fn().mockReturnValue(undefined) };

  const service = new StepUpService(
    userRepo as any,
    userTenantRepo as any,
    otpService as any,
    auditService as any,
    jwtService as any,
    schoolsService as any,
    config as any,
    redis as any,
  );

  return {
    service,
    userRepo,
    userTenantRepo,
    otpService,
    auditService,
    jwtService,
    schoolsService,
    redis,
  };
}

describe('StepUpService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  describe('approverHoldsFeeApprove', () => {
    it('returns true for a role that genuinely holds FEE_APPROVE', () => {
      expect(approverHoldsFeeApprove(UserRole.ADMIN)).toBe(true);
      expect(approverHoldsFeeApprove(UserRole.SUPER_ADMIN)).toBe(true);
    });

    it('returns false for a role that does not hold FEE_APPROVE', () => {
      expect(approverHoldsFeeApprove(UserRole.TEACHER)).toBe(false);
    });
  });

  describe('verify — OTP method', () => {
    function otpDto(overrides: Partial<StepUpVerifyDto> = {}): StepUpVerifyDto {
      return {
        identifier: 'admin@example.com',
        method: 'OTP',
        otp: '123456',
        scope: ApprovalScope.FEES_DUPLICATE_OVERRIDE,
        ...overrides,
      };
    }

    it('issues an approval token with the exact D9 claim shape on success', async () => {
      const { service, jwtService, redis } = buildService();

      const result = await service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT);

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: APPROVER.id,
          act: ACTOR_USER_ID,
          tid: TENANT_ID,
          scope: ApprovalScope.FEES_DUPLICATE_OVERRIDE,
          jti: expect.any(String),
          typ: 'approval',
        },
        { expiresIn: 300 },
      );
      expect(result.approval_token).toBe('signed.jwt.token');
      expect(result.approver).toEqual({ id: APPROVER.id, full_name: APPROVER.full_name });

      // Redis single-use marker stored with a 300s TTL under approval:{jti}.
      const [key, value, mode, ttlMs] = redis.set.mock.calls[0];
      expect(key).toMatch(/^approval:/);
      expect(value).toBe('1');
      expect(mode).toBe('PX');
      expect(ttlMs).toBe(300_000);
    });

    it('audits success with scope, approver_id and actor_id', async () => {
      const { service, auditService } = buildService();

      await service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entity_type: 'ApprovalToken',
          entity_id: expect.any(String),
          tenant_id: TENANT_ID,
          performed_by_user_id: ACTOR_USER_ID,
          new_values: {
            scope: ApprovalScope.FEES_DUPLICATE_OVERRIDE,
            approver_id: APPROVER.id,
            actor_id: ACTOR_USER_ID,
          },
        }),
      );
    });

    it('the actor may verify themselves as the approver (D9)', async () => {
      const { service } = buildService();

      const result = await service.verify(otpDto(), APPROVER.id, TENANT_ID, CONTEXT);

      expect(result.approver.id).toBe(APPROVER.id);
    });

    it('rejects a wrong OTP with 401 and audits the failure without leaking credentials', async () => {
      const otpService = { request: vi.fn(), verify: vi.fn().mockResolvedValue('invalid') };
      const { service, auditService } = buildService({ otpService });

      await expect(service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT)).rejects.toThrow(
        HttpException,
      );

      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe(AuditAction.LOGIN_FAILED);
      expect(JSON.stringify(call.new_values)).not.toContain('123456');
    });

    it('rejects an approver in a different tenant', async () => {
      const { service } = buildService();

      await expect(
        service.verify(otpDto(), ACTOR_USER_ID, 'other-tenant', CONTEXT),
      ).rejects.toThrow(HttpException);
    });

    it('rejects an approver without FEE_APPROVE', async () => {
      const { service } = buildService({ membership: { ...MEMBERSHIP, role: UserRole.TEACHER } });

      await expect(service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT)).rejects.toThrow(
        HttpException,
      );
    });

    it('429s once the per-approver rate limit is exceeded', async () => {
      const { service } = buildService();

      for (let i = 0; i < 5; i++) {
        await service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT).catch(() => undefined);
      }

      await expect(
        service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    });

    // Security-review fix: the approver rate-limit key must be scoped by
    // tenant. Before the fix, `step-up-attempts:approver:${identifier}` was
    // global, so any authenticated caller in ANY tenant could lock a real
    // admin's identifier for 15 minutes by guessing it and failing
    // verification a few times, regardless of eligibility.
    it('scopes the approver rate-limit counter by tenant — a different tenant has its own budget', async () => {
      const { service, redis } = buildService();

      for (let i = 0; i < 5; i++) {
        await service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT).catch(() => undefined);
      }
      await expect(
        service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

      const incrKeys = redis.incr.mock.calls.map((call: unknown[]) => call[0] as string);
      expect(incrKeys.some((key) => key.includes(TENANT_ID))).toBe(true);

      // A different actor, in a different tenant, guessing the same
      // identifier is unaffected — it hasn't touched TENANT_ID's approver
      // counter (a fresh actor id keeps this isolated from the actor-scoped
      // counter exhausted just above).
      const otherActorError = await service
        .verify(otpDto(), 'a-different-actor', 'a-completely-different-tenant', CONTEXT)
        .catch((e) => e);
      expect(otherActorError.status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    // Security-review fix: bcrypt/OTP verification must run at the same
    // cost whether or not the identifier resolves to a real approver —
    // otherwise response latency leaks which identifiers are real.
    it('runs bcrypt.compare against a dummy hash even for an unknown identifier (PASSWORD method)', async () => {
      const schoolsService = {
        getResolvedSettings: vi
          .fn()
          .mockResolvedValue({ version: 1, fees: { approval_mode: ApprovalMode.OTP_OR_PASSWORD } }),
      };
      const { service } = buildService({ schoolsService });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(
        service.verify(
          {
            identifier: 'unknown@example.com',
            method: 'PASSWORD',
            password: 'whatever',
            scope: ApprovalScope.FEES_EDIT_PAID,
          },
          ACTOR_USER_ID,
          TENANT_ID,
          CONTEXT,
        ),
      ).rejects.toThrow(HttpException);

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    it('503s (and never returns 200) when the single-use approval-token marker fails to persist', async () => {
      const { service, redis } = buildService();
      redis.set.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.verify(otpDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT),
      ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    });
  });

  describe('verify — PASSWORD method', () => {
    function passwordDto(overrides: Partial<StepUpVerifyDto> = {}): StepUpVerifyDto {
      return {
        identifier: 'admin@example.com',
        method: 'PASSWORD',
        password: 'correct horse',
        scope: ApprovalScope.PAYMENTS_REVERSE,
        ...overrides,
      };
    }

    it('rejects with 400 PASSWORD_NOT_ALLOWED when approval_mode is not OTP_OR_PASSWORD', async () => {
      const { service } = buildService();

      await expect(
        service.verify(passwordDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows password verification when approval_mode is OTP_OR_PASSWORD', async () => {
      const schoolsService = {
        getResolvedSettings: vi
          .fn()
          .mockResolvedValue({ version: 1, fees: { approval_mode: ApprovalMode.OTP_OR_PASSWORD } }),
      };
      const { service } = buildService({ schoolsService });
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await service.verify(passwordDto(), ACTOR_USER_ID, TENANT_ID, CONTEXT);

      expect(result.approver.id).toBe(APPROVER.id);
    });
  });

  describe('requestOtp', () => {
    it('always resolves without throwing, even for an unknown identifier', async () => {
      const { service } = buildService();

      await expect(service.requestOtp('unknown@example.com', TENANT_ID)).resolves.toEqual({});
    });

    it('calls OtpService.request only for an eligible approver', async () => {
      const { service, otpService } = buildService();

      await service.requestOtp('admin@example.com', TENANT_ID);

      expect(otpService.request).toHaveBeenCalledWith('STEP_UP', 'admin@example.com');

      otpService.request.mockClear();
      await service.requestOtp('unknown@example.com', TENANT_ID);
      expect(otpService.request).not.toHaveBeenCalled();
    });
  });
});
