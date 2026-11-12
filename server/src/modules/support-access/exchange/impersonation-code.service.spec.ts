import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import { IMPERSONATION_REDIS } from '../sessions/impersonation-redis';
import { ImpersonationCodeService } from './impersonation-code.service';

const CODE = 'A'.repeat(43);
const hash = createHash('sha256').update(CODE).digest('hex');

describe('ImpersonationCodeService (unit)', () => {
  let service: ImpersonationCodeService;
  let store: Map<string, string>;
  let redis: Record<string, any>;
  let sessionRow: Record<string, any> | null;
  let userRow: Record<string, any> | null;
  let sessionsRepo: { findOne: ReturnType<typeof vi.fn> };
  let usersRepo: { findOne: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    store = new Map();
    redis = {
      set: vi.fn(async (k: string, v: string) => (store.set(k, v), 'OK')),
      getdel: vi.fn(async (k: string) => {
        const v = store.get(k) ?? null;
        store.delete(k);
        return v;
      }),
      exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    };
    sessionRow = {
      id: 's-1',
      platform_admin_id: 'pa-1',
      tenant_id: 'school-A',
      target_user_id: 'u-1',
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 30 * 60_000),
    };
    userRow = { id: 'u-1', status: UserStatus.ACTIVE };
    sessionsRepo = { findOne: vi.fn(async () => sessionRow) };
    usersRepo = { findOne: vi.fn(async () => userRow) };
    const mod = await Test.createTestingModule({
      providers: [
        ImpersonationCodeService,
        { provide: getRepositoryToken(ImpersonationSession), useValue: sessionsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: IMPERSONATION_REDIS, useValue: redis },
      ],
    }).compile();
    service = mod.get(ImpersonationCodeService);
  });

  const live = () => store.set('imp:s-1', '{}');
  const seed = () => store.set(`imp:code:${hash}`, 's-1');

  it('issue stores only the hash, 43 chars, EX 60', async () => {
    const code = await service.issue('s-1');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [key, val, ex, ttl] = redis.set.mock.calls[0];
    expect(key).toBe(`imp:code:${createHash('sha256').update(code).digest('hex')}`);
    expect(key).not.toContain(code);
    expect([val, ex, ttl]).toEqual(['s-1', 'EX', 60]);
  });

  it('redeems once; the second redeem is the same 401', async () => {
    live();
    seed();
    const r = await service.redeem(CODE);
    expect(r).toMatchObject({ sid: 's-1', userId: 'u-1', adminId: 'pa-1', schoolId: 'school-A' });
    expect(r.remainingSeconds).toBeGreaterThan(1700);
    await expect(service.redeem(CODE)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired code'),
    );
  });

  // Every failure is the same 401 and runs the same lookups (no oracle on which step failed).
  const expectSame401 = async () => {
    await expect(service.redeem(CODE)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid or expired code',
    });
    expect(redis.exists).toHaveBeenCalledTimes(1);
    expect(sessionsRepo.findOne).toHaveBeenCalledTimes(1);
  };

  it('unknown code answers the identical 401 and runs the same lookups', async () => {
    live();
    await expectSame401();
  });

  it('session ended answers the identical 401 and runs the same lookups', async () => {
    live();
    seed();
    sessionRow!.status = 'ENDED';
    await expectSame401();
  });

  it('session expired answers the identical 401 and runs the same lookups', async () => {
    live();
    seed();
    sessionRow!.expires_at = new Date(Date.now() - 1000);
    await expectSame401();
  });

  it('row missing answers the identical 401 and runs the same lookups', async () => {
    live();
    seed();
    sessionRow = null;
    await expectSame401();
  });

  it('person suspended answers the identical 401 and runs the same lookups', async () => {
    live();
    seed();
    userRow!.status = UserStatus.SUSPENDED;
    await expectSame401();
  });

  it('imp key gone answers the identical 401 and runs the same lookups', async () => {
    live();
    seed();
    store.delete('imp:s-1');
    await expectSame401();
  });

  it('Redis error is 503 without echoing the error', async () => {
    redis.getdel.mockRejectedValue(new Error('secret-host:6379 refused'));
    await expect(service.redeem(CODE)).rejects.toMatchObject({ status: 503 });
  });

  it('issue fails closed on a non-OK set', async () => {
    redis.set.mockResolvedValue(null);
    await expect(service.issue('s-1')).rejects.toMatchObject({ status: 503 });
  });
});
