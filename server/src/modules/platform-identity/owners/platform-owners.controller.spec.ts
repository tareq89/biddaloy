import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import { REQUIRE_APPROVAL_KEY } from '../../auth/decorators/require-approval.decorator';
import { REQUIRE_TWO_PERSON_KEY } from '../approvals/require-two-person.decorator';
import { PlatformOwnersController } from './platform-owners.controller';

const proto = PlatformOwnersController.prototype;

describe('PlatformOwnersController', () => {
  const svc: any = { lock: vi.fn(), unlock: vi.fn(), list: vi.fn(), history: vi.fn() };
  const controller = new PlatformOwnersController(svc);
  const req: any = { user: { sub: 'u1' } };

  it('lock and unlock each need their own step-up token', () => {
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, proto.lock)).toBe(
      ApprovalScope.PLATFORM_OWNER_LOCK,
    );
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, proto.unlock)).toBe(
      ApprovalScope.PLATFORM_OWNER_UNLOCK,
    );
  });

  it('neither lock nor unlock needs the other owner, even with the switch on (D8)', () => {
    for (const fn of [proto.lock, proto.unlock]) {
      expect(Reflect.getMetadata(REQUIRE_TWO_PERSON_KEY, fn)).toBeUndefined();
    }
    expect(Reflect.getMetadata(REQUIRE_TWO_PERSON_KEY, PlatformOwnersController)).toBeUndefined();
  });

  it('the list and history need no approval token', () => {
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, proto.list)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, proto.history)).toBeUndefined();
  });

  it('there is no delete route (D10)', () => {
    expect(Object.getOwnPropertyNames(proto).sort()).toEqual(
      ['constructor', 'history', 'list', 'lock', 'unlock'].sort(),
    );
  });

  it('passes the signed-in owner as the actor', async () => {
    await controller.lock('target-1', req);
    await controller.unlock('target-2', req);
    expect(svc.lock).toHaveBeenCalledWith('u1', 'target-1');
    expect(svc.unlock).toHaveBeenCalledWith('u1', 'target-2');
  });
});
