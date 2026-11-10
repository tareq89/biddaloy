import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@biddaloy/shared';
import { CockpitSessionService } from './cockpit-session.service';

function fakeRedis() {
  const store = new Map<string, number>(); // key -> expiry ms
  const live = (k: string) => (store.get(k) ?? 0) > Date.now();
  return {
    store,
    set: vi.fn(async (k: string, _v: string, _px: string, ms: number, xx?: string) => {
      if (xx === 'XX' && !live(k)) return null;
      store.set(k, Date.now() + ms);
      return 'OK';
    }),
    exists: vi.fn(async (k: string) => (live(k) ? 1 : 0)),
    pttl: vi.fn(async (k: string) => (live(k) ? store.get(k)! - Date.now() : -2)),
    del: vi.fn(async (...ks: string[]) => ks.forEach((k) => store.delete(k))),
  };
}

describe('CockpitSessionService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let tokens: any;
  let cutoff: any;
  let users: any;
  let admins: any;
  let svc: CockpitSessionService;
  const ctx = { ip: null, userAgent: null };

  beforeEach(() => {
    redis = fakeRedis();
    tokens = {
      issueForUser: vi.fn().mockResolvedValue({ cookieValue: 'id.s', expiresAt: new Date() }),
      familyIdForCookie: vi.fn().mockResolvedValue('fam'),
      rotate: vi.fn().mockResolvedValue({ userId: 'u1', refreshToken: { cookieValue: 'id2.s2' } }),
      revokeFamily: vi.fn(),
      revokeByCookieValue: vi.fn(),
      revokeAllForUser: vi.fn(),
      listActiveSessions: vi.fn().mockResolvedValue([{ familyId: 'f1' }, { familyId: 'f2' }]),
      countForFamily: vi.fn().mockResolvedValue(1),
    };
    cutoff = { cutOff: vi.fn() };
    users = { findOne: vi.fn().mockResolvedValue({ id: 'u1', status: UserStatus.ACTIVE }) };
    admins = { count: vi.fn().mockResolvedValue(1) };
    svc = new CockpitSessionService(
      new JwtService({
        secret: 'secret-secret-secret-secret-12',
        signOptions: { issuer: 'biddaloy' },
      }),
      tokens,
      cutoff,
      redis as any,
      users,
      admins,
      { idleMs: 1000, absoluteMs: 5000 },
    );
  });

  it('start sets both keys, issues an 8 h-capped refresh token and a cockpit token', async () => {
    const out = await svc.start('u1', ctx);
    expect(redis.store.size).toBe(2);
    expect(tokens.issueForUser).toHaveBeenCalledWith('u1', out.familyId, ctx, 5000);
    const payload: any = new JwtService({}).decode(out.accessToken);
    expect(payload).toMatchObject({
      sub: 'u1',
      fam: out.familyId,
      typ: 'cockpit',
      aud: 'biddaloy:cockpit',
    });
  });

  it('refresh refuses when the idle key is gone, rotates with the absolute time left otherwise', async () => {
    const { familyId } = await svc.start('u1', ctx);
    tokens.familyIdForCookie.mockResolvedValue(familyId);
    redis.store.delete(`cockpit:idle:${familyId}`);
    await expect(svc.refresh('c', ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.rotate).not.toHaveBeenCalled();

    redis.store.set(`cockpit:idle:${familyId}`, Date.now() + 1000);
    await svc.refresh('c', ctx);
    expect(tokens.rotate.mock.calls[0][2]).toBeLessThanOrEqual(5000);
  });

  it('refresh refuses when the absolute key is gone, even with a live idle key', async () => {
    const { familyId } = await svc.start('u1', ctx);
    tokens.familyIdForCookie.mockResolvedValue(familyId);
    redis.store.delete(`cockpit:abs:${familyId}`);
    await expect(svc.refresh('c', ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh revokes the family when the owner is locked', async () => {
    const { familyId } = await svc.start('u1', ctx);
    tokens.familyIdForCookie.mockResolvedValue(familyId);
    users.findOne.mockResolvedValue({ id: 'u1', status: UserStatus.SUSPENDED });
    await expect(svc.refresh('c', ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.revokeFamily).toHaveBeenCalledWith(familyId);
  });

  it('touch never resurrects an expired idle key', async () => {
    const { familyId } = await svc.start('u1', ctx);
    redis.store.delete(`cockpit:idle:${familyId}`);
    await expect(svc.touch(familyId)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.store.has(`cockpit:idle:${familyId}`)).toBe(false);
  });

  it('Redis down refuses (503), never lets a session start or touch', async () => {
    redis.set.mockRejectedValue(new Error('down'));
    redis.exists.mockRejectedValue(new Error('down'));
    await expect(svc.start('u1', ctx)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.touch('f')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tokens.issueForUser).not.toHaveBeenCalled();
  });

  it('endAll revokes every family, bumps tokens_valid_after and drops the keys', async () => {
    await svc.endAll('u1');
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(cutoff.cutOff).toHaveBeenCalledWith('u1');
    expect(redis.del).toHaveBeenCalledTimes(2);
  });

  it('endFamily answers false for a family the user does not own', async () => {
    tokens.countForFamily.mockResolvedValue(0);
    expect(await svc.endFamily('u1', 'x')).toBe(false);
    expect(tokens.revokeFamily).not.toHaveBeenCalled();
  });
});
