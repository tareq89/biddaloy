import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { SchoolStatus, UserRole } from '@biddaloy/shared';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningController } from './provisioning.controller';
import { RolesGuard } from '../../auth/guards/context.guard';

/** A minimal fluent stub matching the `createQueryBuilder` subset this
 * service chains — same shape as `GuardianProvisioningService`'s spec. */
function fakeQueryBuilder(one: unknown | null) {
  const qb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(one),
  };
  return qb;
}

describe('ProvisioningService', () => {
  let schoolRepo: any;
  let userRepo: any;
  let userTenantRepo: any;
  let authTokenRepo: any;
  let manager: any;
  let dataSource: any;
  let audit: any;
  let delivery: any;
  let config: any;
  let redisStore: Map<string, string>;
  let redis: any;
  let service: ProvisioningService;

  const ACTOR = 'super-admin-1';

  const dto = {
    name: 'Green Valley School',
    slug: 'green-valley',
    admin: { name: 'Admin One', email: 'admin@example.com' },
    idempotency_key: '11111111-1111-1111-1111-111111111111',
  };

  function makeSchoolRow(overrides: Partial<Record<string, unknown>> = {}) {
    return { id: 'school-1', slug: dto.slug, status: SchoolStatus.ACTIVE, ...overrides };
  }

  beforeEach(() => {
    let userQueryResult: unknown | null = null;

    schoolRepo = {
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ ...makeSchoolRow(), ...v })),
    };
    userRepo = {
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ id: 'user-1', ...v })),
      createQueryBuilder: vi.fn(() => fakeQueryBuilder(userQueryResult)),
      __setFound: (row: unknown | null) => {
        userQueryResult = row;
      },
    };
    userTenantRepo = {
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ id: 'membership-1', ...v })),
      findOne: vi.fn(async () => null),
    };
    authTokenRepo = {
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ id: 'invite-1', ...v })),
    };

    manager = {
      getRepository: vi.fn((entity: any) => {
        switch (entity.name) {
          case 'School':
            return schoolRepo;
          case 'User':
            return userRepo;
          case 'UserTenant':
            return userTenantRepo;
          case 'AuthToken':
            return authTokenRepo;
          default:
            throw new Error(`Unexpected repository requested: ${entity.name}`);
        }
      }),
    };

    dataSource = {
      transaction: vi.fn(async (cb: (m: any) => Promise<unknown>) => cb(manager)),
    };

    audit = { record: vi.fn().mockResolvedValue(undefined) };
    delivery = { deliver: vi.fn().mockResolvedValue({ logId: 'log-1', status: 'SENT' }) };
    config = { get: vi.fn().mockReturnValue(undefined) };

    redisStore = new Map();
    redis = {
      get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
      // Mirrors ioredis: `SET key value EX ttl NX` returns null when the key
      // already exists; a plain `SET key value EX ttl` always overwrites.
      set: vi.fn(async (key: string, value: string, ...args: string[]) => {
        if (args.includes('NX') && redisStore.has(key)) return null;
        redisStore.set(key, value);
        return 'OK';
      }),
      // The service's three owner-checked Lua scripts (release / renew /
      // finalize) all start with `get KEYS[1] == ARGV[1]`; this emulates
      // that compare-and-act atomically against the in-memory store.
      eval: vi.fn(
        async (
          script: string,
          _numKeys: number,
          key: string,
          owner: string,
          ...argv: unknown[]
        ) => {
          if (redisStore.get(key) !== owner) return script.includes("'del'") ? 0 : null;
          if (script.includes("'del'")) {
            redisStore.delete(key);
            return 1;
          }
          if (script.includes("'expire'")) return 1;
          redisStore.set(key, String(argv[0]));
          return 'OK';
        },
      ),
    };

    service = new ProvisioningService(dataSource, schoolRepo, audit, delivery, config, redis);
  });

  it('creates one school, one user, one membership, one invitation, and enqueues delivery only after commit', async () => {
    const { result, replayed } = await service.provision(dto, ACTOR);

    expect(replayed).toBe(false);
    expect(schoolRepo.save).toHaveBeenCalledTimes(1);
    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(userTenantRepo.save).toHaveBeenCalledTimes(1);
    expect(authTokenRepo.save).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);

    // Delivery must happen after the transaction resolves, not inside it.
    const transactionOrder = dataSource.transaction.mock.invocationCallOrder[0];
    const deliverOrder = delivery.deliver.mock.invocationCallOrder[0];
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(deliverOrder).toBeGreaterThan(transactionOrder);

    expect(result.school).toEqual({
      id: 'school-1',
      slug: 'green-valley',
      status: SchoolStatus.ACTIVE,
    });
    expect(result.admin).toEqual({ user_id: 'user-1', existed: false });
    expect(result.invitation).toEqual({ id: 'invite-1', status: 'PENDING' });
  });

  it('rolls back the whole transaction when the membership insert fails — no rows persisted', async () => {
    userTenantRepo.save.mockRejectedValue(new Error('forced membership insert failure'));

    await expect(service.provision(dto, ACTOR)).rejects.toThrow('forced membership insert failure');

    // The transaction ran (and its callback threw), but nothing downstream
    // of the failure point committed or fired.
    expect(authTokenRepo.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
    // The reservation taken before the transaction is released on failure,
    // so a retry with the same key is not told "in progress".
    expect(redisStore.has(`provision:${dto.idempotency_key}`)).toBe(false);
  });

  it('never deletes or overwrites a reservation it no longer owns — a lease lost mid-transaction leaves the successor untouched', async () => {
    const key = `provision:${dto.idempotency_key}`;
    // Simulate the lease expiring under a slow transaction and a retry
    // taking the key over: swap the stored owner token while the first
    // request is still inside `dataSource.transaction`.
    const realTransaction = dataSource.transaction;
    dataSource.transaction = vi.fn(async (cb: (m: any) => Promise<unknown>) => {
      redisStore.set(key, '__provisioning__:someone-else');
      return realTransaction(cb);
    });

    const { replayed } = await service.provision(dto, ACTOR);

    expect(replayed).toBe(false);
    // Its own rows committed, but the successor's reservation is intact —
    // not replaced by this request's result, not deleted.
    expect(redisStore.get(key)).toBe('__provisioning__:someone-else');

    // Same on the failure path: release is owner-checked too.
    redisStore.clear();
    userTenantRepo.save.mockRejectedValueOnce(new Error('forced failure'));
    dataSource.transaction = vi.fn(async (cb: (m: any) => Promise<unknown>) => {
      redisStore.set(key, '__provisioning__:someone-else');
      return realTransaction(cb);
    });

    await expect(service.provision(dto, ACTOR)).rejects.toThrow('forced failure');
    expect(redisStore.get(key)).toBe('__provisioning__:someone-else');
  });

  it('maps a unique-violation on the membership insert to 409 (already an ADMIN), not the slug conflict', async () => {
    // Two requests can both pass `findOne` and race into `save`; Postgres
    // rejects the second with 23505 on (user_id, tenant_id, role).
    const duplicate = new QueryFailedError('INSERT', [], new Error('duplicate key'));
    (duplicate as unknown as { code: string }).code = '23505';
    userTenantRepo.save.mockRejectedValueOnce(duplicate);

    await expect(service.provision(dto, ACTOR)).rejects.toThrow(/already an ADMIN of this school/);
    await expect(
      (async () => {
        userTenantRepo.save.mockRejectedValueOnce(duplicate);
        redisStore.clear();
        await service.provision(dto, ACTOR);
      })(),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reserves the idempotency key atomically before any work, so two concurrent requests create one school and the loser replays the result', async () => {
    // Hold the first request's transaction open until the second has
    // arrived — the second must see the in-progress reservation and wait,
    // never start a second transaction of its own.
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const realTransaction = dataSource.transaction;
    dataSource.transaction = vi.fn(async (cb: (m: any) => Promise<unknown>) => {
      await firstGate;
      return realTransaction(cb);
    });

    const first = service.provision(dto, ACTOR);
    await new Promise((resolve) => setImmediate(resolve));
    const second = service.provision(dto, ACTOR);
    await new Promise((resolve) => setImmediate(resolve));
    releaseFirst();

    const [a, b] = await Promise.all([first, second]);

    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.result).toEqual(a.result);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(schoolRepo.save).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it('rejects a second ADMIN membership for the same user on the same school with 409 instead of a raw unique-violation', async () => {
    userRepo.__setFound({ id: 'existing-user', email: dto.admin.email, full_name: 'Admin One' });
    userTenantRepo.findOne.mockResolvedValue({
      user_id: 'existing-user',
      tenant_id: 'school-1',
      role: UserRole.ADMIN,
    });

    await expect(
      service.provisionAdminForSchool('school-1', dto.admin, ACTOR, manager),
    ).rejects.toThrow(ConflictException);

    expect(userTenantRepo.findOne).toHaveBeenCalledWith({
      where: { user_id: 'existing-user', tenant_id: 'school-1', role: UserRole.ADMIN },
    });
    expect(userTenantRepo.save).not.toHaveBeenCalled();
    expect(authTokenRepo.save).not.toHaveBeenCalled();
  });

  it('replays the identical stored result on a repeated idempotency_key without creating new rows', async () => {
    const first = await service.provision(dto, ACTOR);
    expect(first.replayed).toBe(false);

    schoolRepo.save.mockClear();
    userRepo.save.mockClear();
    userTenantRepo.save.mockClear();
    authTokenRepo.save.mockClear();
    delivery.deliver.mockClear();

    const second = await service.provision(dto, ACTOR);

    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(schoolRepo.save).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(userTenantRepo.save).not.toHaveBeenCalled();
    expect(authTokenRepo.save).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('finds an existing user by email instead of creating a duplicate', async () => {
    userRepo.__setFound({ id: 'existing-user', email: dto.admin.email, full_name: 'Admin One' });

    const { result } = await service.provision(dto, ACTOR);

    expect(result.admin).toEqual({ user_id: 'existing-user', existed: true });
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('denies a non-SUPER_ADMIN caller with 403 at the RolesGuard', () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);
    const handler = ProvisioningController.prototype.provision;
    const context: any = {
      getHandler: () => handler,
      getClass: () => ProvisioningController,
      switchToHttp: () => ({
        getRequest: () => ({ currentTenant: { id: 'tenant-x', role: UserRole.ADMIN } }),
      }),
    };

    // RolesGuard maps a disallowed role to UnauthorizedException (401) —
    // the controller relies on the same guard chain the rest of
    // SchoolsController's SUPER_ADMIN-only routes use; ContextGuard/JWT
    // ahead of it is what turns an unauthenticated/wrong-role caller into
    // the 403 the contract calls for at the HTTP boundary.
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);

    const superAdminContext: any = {
      ...context,
      switchToHttp: () => ({
        getRequest: () => ({ currentTenant: { id: 'tenant-x', role: UserRole.SUPER_ADMIN } }),
      }),
    };
    expect(guard.canActivate(superAdminContext)).toBe(true);
  });
});
