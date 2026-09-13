import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ApprovalScope } from '@biddaloy/shared';
import { ApprovalGuard, ApprovalService, ApprovalTokenPayload } from './approval.guard';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';
import { REQUIRE_APPROVAL_KEY } from '../decorators/require-approval.decorator';

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const APPROVER_ID = 'approver-1';
const JTI = 'jti-1';

function validPayload(overrides: Partial<ApprovalTokenPayload> = {}): ApprovalTokenPayload {
  return {
    typ: 'approval',
    sub: APPROVER_ID,
    act: ACTOR_ID,
    tid: TENANT_ID,
    scope: ApprovalScope.PAYMENTS_REVERSE,
    jti: JTI,
    ...overrides,
  };
}

function makeRequest(headerToken: string | null) {
  return {
    headers: headerToken ? { 'x-approval-token': headerToken } : {},
    currentTenant: { id: TENANT_ID },
    user: { sub: ACTOR_ID },
  };
}

describe('ApprovalService.consume', () => {
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let redis: { getdel: ReturnType<typeof vi.fn> };
  let service: ApprovalService;

  beforeEach(() => {
    jwtService = { verifyAsync: vi.fn() };
    configService = { get: vi.fn().mockReturnValue('secret') };
    redis = { getdel: vi.fn() };
    service = new ApprovalService(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      redis as any,
    );
  });

  it('missing X-Approval-Token header throws APPROVAL_REQUIRED', async () => {
    await expect(
      service.consume(makeRequest(null), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('expired/invalid JWT throws APPROVAL_REQUIRED', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(
      service.consume(makeRequest('signed-token'), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('wrong scope throws APPROVAL_REQUIRED', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload({ scope: ApprovalScope.FEES_DISCOUNT }));

    await expect(
      service.consume(makeRequest('signed-token'), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('wrong actor (act mismatch with req.user.sub) throws APPROVAL_REQUIRED', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload({ act: 'someone-else' }));

    await expect(
      service.consume(makeRequest('signed-token'), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('wrong tenant (tid mismatch with req.currentTenant.id) throws APPROVAL_REQUIRED', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload({ tid: 'other-tenant' }));

    await expect(
      service.consume(makeRequest('signed-token'), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('wrong token typ throws APPROVAL_REQUIRED', async () => {
    jwtService.verifyAsync.mockResolvedValue({ ...validPayload(), typ: 'access' } as any);

    await expect(
      service.consume(makeRequest('signed-token'), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
  });

  it('reused jti (GETDEL misses) throws APPROVAL_REQUIRED', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    redis.getdel.mockResolvedValue(null);

    await expect(
      service.consume(makeRequest('signed-token'), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
    expect(redis.getdel).toHaveBeenCalledWith(`approval:${JTI}`);
  });

  it('a Redis error consuming the key fails closed, not open', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    redis.getdel.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      service.consume(makeRequest('signed-token'), ApprovalScope.PAYMENTS_REVERSE),
    ).rejects.toThrow(ApprovalRequiredException);
  });

  it('missing session context (no currentTenant/user) throws 401, not APPROVAL_REQUIRED', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    const req = { headers: { 'x-approval-token': 'signed-token' } };

    await expect(service.consume(req as any, ApprovalScope.PAYMENTS_REVERSE)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('a fully valid token is consumed exactly once and returns the approval context', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    redis.getdel.mockResolvedValue('1');

    const result = await service.consume(
      makeRequest('signed-token'),
      ApprovalScope.PAYMENTS_REVERSE,
    );

    expect(result).toEqual({
      approverId: APPROVER_ID,
      scope: ApprovalScope.PAYMENTS_REVERSE,
      jti: JTI,
    });
    expect(redis.getdel).toHaveBeenCalledWith(`approval:${JTI}`);
  });
});

describe('ApprovalGuard', () => {
  let reflector: Reflector;
  let approvalService: { consume: ReturnType<typeof vi.fn> };
  let guard: ApprovalGuard;

  beforeEach(() => {
    reflector = new Reflector();
    approvalService = { consume: vi.fn() };
    guard = new ApprovalGuard(reflector, approvalService as unknown as ApprovalService);
  });

  function createMockContext(req: any, scope?: ApprovalScope) {
    const handler = () => {};
    class TestController {}
    if (scope) {
      Reflect.defineMetadata(REQUIRE_APPROVAL_KEY, scope, handler);
    }
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as any;
  }

  it('allows the request through untouched when no @RequireApproval metadata is present', async () => {
    const req = makeRequest('signed-token');
    const context = createMockContext(req);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(approvalService.consume).not.toHaveBeenCalled();
  });

  it('delegates to ApprovalService.consume and stamps req.approval on success', async () => {
    const req = makeRequest('signed-token');
    const context = createMockContext(req, ApprovalScope.PAYMENTS_REVERSE);
    const approvalContext = {
      approverId: APPROVER_ID,
      scope: ApprovalScope.PAYMENTS_REVERSE,
      jti: JTI,
    };
    approvalService.consume.mockResolvedValue(approvalContext);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(approvalService.consume).toHaveBeenCalledWith(req, ApprovalScope.PAYMENTS_REVERSE);
    expect((req as any).approval).toEqual(approvalContext);
  });

  it('propagates ApprovalService.consume rejection (e.g. APPROVAL_REQUIRED)', async () => {
    const req = makeRequest('signed-token');
    const context = createMockContext(req, ApprovalScope.PAYMENTS_REVERSE);
    approvalService.consume.mockRejectedValue(
      new ApprovalRequiredException(ApprovalScope.PAYMENTS_REVERSE),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(ApprovalRequiredException);
  });
});
