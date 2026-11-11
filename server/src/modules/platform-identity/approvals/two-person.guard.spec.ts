import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import { TwoPersonGuard } from './two-person.guard';
import { RequireTwoPerson, REQUIRE_TWO_PERSON_KEY } from './require-two-person.decorator';
import { hashPayload } from './platform-approvals.service';

const UUID = '0b8f3c1e-5d2a-4f6b-9a7c-1e2d3c4b5a69';

function ctx(req: object, gated = true) {
  const handler = () => undefined;
  if (gated)
    RequireTwoPerson(ApprovalScope.PLATFORM_OWNER_LOCK, () => ({ action: 'lock' }))({}, 'x', {
      value: handler,
    } as never);
  const meta = gated ? Reflect.getMetadata(REQUIRE_TWO_PERSON_KEY, handler) : undefined;
  return {
    context: {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
    meta,
  };
}

describe('TwoPersonGuard', () => {
  let settings: any, owners: any, approvals: any, reflector: any;
  let guard: TwoPersonGuard;
  const req = (headers: object = {}) => ({
    user: { sub: 'u1' },
    method: 'POST',
    originalUrl: '/platform/owners/x/lock?y=1',
    body: { reason: 'r' },
    headers,
  });
  const run = async (r: object, gated = true) => {
    const { context, meta } = ctx(r, gated);
    reflector.getAllAndOverride.mockReturnValue(meta);
    return guard.canActivate(context);
  };

  beforeEach(() => {
    settings = { get: vi.fn().mockResolvedValue(true) };
    owners = { activeOwnerIds: vi.fn().mockResolvedValue(['u1', 'u2']) };
    approvals = {
      request: vi.fn().mockResolvedValue({ id: 'req-1' }),
      consume: vi.fn().mockResolvedValue(true),
    };
    reflector = { getAllAndOverride: vi.fn() };
    guard = new TwoPersonGuard(reflector, settings, owners, approvals);
  });

  it('lets an undecorated route through', async () => {
    expect(await run(req(), false)).toBe(true);
    expect(approvals.request).not.toHaveBeenCalled();
  });

  it('is off when the switch is off', async () => {
    settings.get.mockResolvedValue(false);
    expect(await run(req())).toBe(true);
    expect(approvals.request).not.toHaveBeenCalled();
  });

  it('is off when only one owner is active (a locked owner never blocks the other)', async () => {
    owners.activeOwnerIds.mockResolvedValue(['u1']);
    expect(await run(req())).toBe(true);
  });

  it('a requester locked while the request was in flight is refused, not let through', async () => {
    owners.activeOwnerIds.mockResolvedValue(['u2']); // u1 was just locked; one owner is left
    await expect(run(req())).rejects.toMatchObject({ status: 403 });
    expect(approvals.request).not.toHaveBeenCalled();
    expect(approvals.consume).not.toHaveBeenCalled();
  });

  it('without a header it files a request and answers 403 APPROVAL_REQUESTED', async () => {
    await expect(run(req())).rejects.toMatchObject({
      status: 403,
      response: { details: { code: 'APPROVAL_REQUESTED', requestId: 'req-1' } },
    });
    expect(approvals.request).toHaveBeenCalledWith(
      'u1',
      ApprovalScope.PLATFORM_OWNER_LOCK,
      { method: 'POST', path: '/platform/owners/x/lock', body: { reason: 'r' } },
      { action: 'lock' },
    );
  });

  it('with a header it consumes the grant for this exact request', async () => {
    expect(await run(req({ 'x-platform-approval': UUID }))).toBe(true);
    expect(approvals.consume).toHaveBeenCalledWith(
      UUID,
      'u1',
      hashPayload({ method: 'POST', path: '/platform/owners/x/lock', body: { reason: 'r' } }),
    );
  });

  it('a refused grant or a non-UUID header answers 403 APPROVAL_INVALID and files nothing', async () => {
    approvals.consume.mockResolvedValue(false);
    await expect(run(req({ 'x-platform-approval': UUID }))).rejects.toMatchObject({
      response: { details: { code: 'APPROVAL_INVALID' } },
    });
    await expect(run(req({ 'x-platform-approval': 'nope' }))).rejects.toMatchObject({
      response: { details: { code: 'APPROVAL_INVALID' } },
    });
    expect(approvals.request).not.toHaveBeenCalled();
  });
});
