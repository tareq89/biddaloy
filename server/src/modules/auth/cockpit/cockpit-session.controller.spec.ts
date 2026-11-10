import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { CockpitSessionController } from './cockpit-session.controller';
import { COCKPIT_REFRESH_COOKIE } from './cockpit-token-cookie';

const req = (extra: object = {}): any => ({
  ip: '1.1.1.1',
  headers: { 'user-agent': 'ua' },
  cookies: { [COCKPIT_REFRESH_COOKIE]: 'id.secret' },
  user: { sub: 'u1', jti: 'j', fam: 'fam-1', typ: 'cockpit' },
  ...extra,
});
const res = () => ({ cookie: vi.fn(), clearCookie: vi.fn(), setHeader: vi.fn() }) as any;

describe('CockpitSessionController', () => {
  let svc: any;
  let controller: CockpitSessionController;

  beforeEach(() => {
    svc = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'a', refreshCookieValue: 'c' }),
      end: vi.fn().mockResolvedValue(undefined),
      endAll: vi.fn().mockResolvedValue(undefined),
      endFamily: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([
        {
          familyId: 'fam-1',
          startedAt: new Date(0),
          lastUsedAt: new Date(0),
          userAgent: 'ua',
          ipAddress: 'ip',
        },
        {
          familyId: 'fam-2',
          startedAt: new Date(0),
          lastUsedAt: new Date(0),
          userAgent: null,
          ipAddress: null,
        },
      ]),
    };
    controller = new CockpitSessionController(svc);
  });

  it('is mounted at auth/cockpit', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CockpitSessionController)).toBe('auth/cockpit');
  });

  it('refresh reads the cookie, sets the new cookie, returns the access token', async () => {
    const r = res();
    expect(await controller.refresh(req(), r)).toEqual({ access_token: 'a' });
    expect(svc.refresh).toHaveBeenCalledWith('id.secret', { ip: '1.1.1.1', userAgent: 'ua' });
    expect(r.cookie).toHaveBeenCalled();
  });

  it('logout ends the session and clears the cookie', async () => {
    const r = res();
    await controller.logout(req(), r);
    expect(svc.end).toHaveBeenCalledWith('id.secret');
    expect(r.clearCookie).toHaveBeenCalled();
  });

  it('logout-all ends every session of the caller', async () => {
    await controller.logoutAll(req(), res());
    expect(svc.endAll).toHaveBeenCalledWith('u1');
  });

  it('sessions marks the current family', async () => {
    const out = await controller.list(req(), res());
    expect(out.data.map((s) => s.current)).toEqual([true, false]);
  });

  it('revoking a foreign family is a 404; revoking the current one clears the cookie', async () => {
    svc.endFamily.mockResolvedValueOnce(false);
    await expect(controller.revoke('x', req(), res())).rejects.toBeInstanceOf(NotFoundException);
    const r = res();
    await controller.revoke('fam-1', req(), r);
    expect(r.clearCookie).toHaveBeenCalled();
  });

  it('every state-changing route carries guards', () => {
    for (const name of ['refresh', 'logout', 'logoutAll', 'revoke'] as const) {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, CockpitSessionController.prototype[name]),
      ).toBeDefined();
    }
  });
});
