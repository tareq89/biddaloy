import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@biddaloy/shared';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { PlatformAttentionController } from './platform-attention.controller';

const req = (sub = 'owner-1'): any => ({ user: { sub, typ: 'cockpit' } });

describe('PlatformAttentionController', () => {
  let svc: any, home: any, controller: PlatformAttentionController;
  beforeEach(() => {
    svc = {
      items: vi.fn().mockResolvedValue({ items: [] }),
      summary: vi.fn().mockResolvedValue({}),
      markSeen: vi.fn().mockResolvedValue({ updated: 0 }),
      hide: vi.fn().mockResolvedValue({}),
      snooze: vi.fn().mockResolvedValue({}),
    };
    home = { id: vi.fn().mockResolvedValue('home-1') };
    controller = new PlatformAttentionController(svc, home);
  });

  it('reads only the signed-in owner’s alerts, on the platform home school as SUPER_ADMIN', async () => {
    await controller.items(req('owner-1'), { tab: 'active', page: 1, pageSize: 20 } as any);
    expect(svc.items).toHaveBeenCalledWith(
      'home-1',
      'owner-1',
      UserRole.SUPER_ADMIN,
      expect.anything(),
    );
    await controller.summary(req('owner-2'), {} as any);
    expect(svc.summary).toHaveBeenCalledWith('home-1', 'owner-2', UserRole.SUPER_ADMIN, {});
  });

  it('seen, hide and snooze are scoped by the owner id from the token, never from the body', async () => {
    await controller.seen(req('owner-1'), { recipientIds: ['r1'] } as any);
    expect(svc.markSeen).toHaveBeenCalledWith('home-1', 'owner-1', ['r1']);
    await controller.hide(req('owner-1'), 'r1', {} as any);
    expect(svc.hide).toHaveBeenCalledWith(
      'home-1',
      'owner-1',
      'r1',
      undefined,
      UserRole.SUPER_ADMIN,
    );
    await controller.snooze(req('owner-1'), 'r1', { choice: 'TWO_HOURS' } as any, {} as any);
    expect(svc.snooze).toHaveBeenCalledWith(
      'home-1',
      'owner-1',
      'r1',
      { choice: 'TWO_HOURS' },
      expect.any(Date),
      undefined,
      UserRole.SUPER_ADMIN,
    );
  });

  it('refuses when no platform home exists, with the owners-only sentence', async () => {
    home.id.mockResolvedValue(undefined);
    await expect(controller.items(req(), {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.items).not.toHaveBeenCalled();
  });

  it('is behind the cockpit JWT and PlatformAdminGuard, so a school-app token is refused', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PlatformAttentionController);
    expect(guards).toHaveLength(2);
    expect(guards).toContain(PlatformAdminGuard);
  });
});
