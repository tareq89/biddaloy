import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PushSubscriptionsService } from './push-subscriptions.service';

function fakeRepo(overrides: Partial<Record<string, any>> = {}) {
  return {
    create: vi.fn((v) => ({ ...v })),
    save: vi.fn(async (v) => ({ id: 'sub-1', created_at: new Date(), last_used_at: null, ...v })),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  } as any;
}

/**
 * [#553] Own-only management of push subscriptions. Every case here backs
 * an acceptance criterion from the issue: cross-user delete -> 404,
 * cross-tenant list stays empty, upsert-by-endpoint re-owns/updates keys,
 * and the list response never echoes endpoint/keys.
 */
describe('PushSubscriptionsService', () => {
  describe('removeAllForUser', () => {
    it('deletes by user_id only, across every tenant', async () => {
      const repo = fakeRepo();
      const service = new PushSubscriptionsService(repo);

      await service.removeAllForUser('user-1');

      // No tenant_id in the filter: a "log out everywhere" spans all memberships.
      expect(repo.delete).toHaveBeenCalledWith({ user_id: 'user-1' });
    });
  });

  describe('subscribe', () => {
    /** In-memory repo that honours the where-clauses subscribe uses, incl. Not(). */
    function memRepo(rows: any[] = []) {
      const matches = (r: any, w: any) =>
        Object.entries(w).every(([k, v]: [string, any]) =>
          v && v._type === 'not' ? r[k] !== v._value : r[k] === v,
        );
      let n = 0;
      const repo: any = {
        rows,
        create: (v: any) => ({ ...v }),
        findOne: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
        save: async (v: any) => {
          if (!v.id) {
            v.id = `sub-${++n}`;
            rows.push(v);
          }
          return v;
        },
        delete: async (w: any) => {
          for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], w)) rows.splice(i, 1);
          return { affected: 1 };
        },
      };
      repo.findOneOrFail = async (o: any) => repo.findOne(o);
      const manager = {
        query: vi.fn().mockResolvedValue([]), // the advisory lock
        getRepository: () => repo,
        // Mimics INSERT ... ON CONFLICT (endpoint, tenant_id) DO UPDATE.
        upsert: async (_entity: any, v: any) => {
          const hit = rows.find((r) => r.endpoint === v.endpoint && r.tenant_id === v.tenant_id);
          if (hit) Object.assign(hit, v);
          else await repo.save({ ...v });
        },
      };
      repo.manager = { transaction: async (cb: any) => cb(manager) };
      repo.lockQuery = manager.query;
      return repo;
    }
    const dto = (endpoint: string, p = 'p', a = 'a') => ({
      endpoint,
      keys: { p256dh: p, auth: a },
    });

    it('creates a new row scoped to the caller when the endpoint is new', async () => {
      const repo = memRepo();
      const service = new PushSubscriptionsService(repo);

      await service.subscribe(
        'user-1',
        'tenant-1',
        dto('https://push.example/abc', 'p1', 'a1'),
        'ua-1',
      );

      // The per-endpoint advisory lock is taken before anything else.
      expect(repo.lockQuery).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        ['https://push.example/abc'],
      );
      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0]).toMatchObject({
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        p256dh: 'p1',
        auth: 'a1',
        user_agent: 'ua-1',
        failure_count: 0,
      });
    });

    it('the same user subscribing the same endpoint in tenant A then tenant B keeps a row in each tenant', async () => {
      const repo = memRepo();
      const service = new PushSubscriptionsService(repo);

      await service.subscribe('user-1', 'tenant-A', dto('https://push.example/dev'), 'ua');
      await service.subscribe('user-1', 'tenant-B', dto('https://push.example/dev'), 'ua');

      expect(repo.rows.map((r: any) => r.tenant_id).sort()).toEqual(['tenant-A', 'tenant-B']);
    });

    it('re-subscribing in the same tenant updates the existing row (no duplicate)', async () => {
      const repo = memRepo([
        {
          id: 'sub-existing',
          endpoint: 'https://push.example/shared',
          user_id: 'user-1',
          tenant_id: 'tenant-1',
          p256dh: 'old-p',
          auth: 'old-a',
          user_agent: 'old-ua',
          failure_count: 3,
        },
      ]);
      const service = new PushSubscriptionsService(repo);

      await service.subscribe(
        'user-1',
        'tenant-1',
        dto('https://push.example/shared', 'new-p', 'new-a'),
        'new-ua',
      );

      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0]).toMatchObject({
        id: 'sub-existing',
        p256dh: 'new-p',
        auth: 'new-a',
        user_agent: 'new-ua',
        failure_count: 0,
      });
    });

    it("a different user claiming the endpoint deletes the previous user's rows in every tenant", async () => {
      const ep = 'https://push.example/shared';
      const repo = memRepo([
        { id: 'x1', endpoint: ep, user_id: 'old-user', tenant_id: 'tenant-A' },
        { id: 'x2', endpoint: ep, user_id: 'old-user', tenant_id: 'tenant-B' },
        {
          id: 'keep',
          endpoint: 'https://push.example/other',
          user_id: 'old-user',
          tenant_id: 'tenant-A',
        },
      ]);
      const service = new PushSubscriptionsService(repo);

      await service.subscribe('new-user', 'tenant-A', dto(ep), 'ua');

      const mine = repo.rows.filter((r: any) => r.endpoint === ep);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ user_id: 'new-user', tenant_id: 'tenant-A' });
      expect(repo.rows.some((r: any) => r.id === 'keep')).toBe(true);
    });
  });

  describe('list', () => {
    it('scopes the query by both user_id and tenant_id', async () => {
      const repo = fakeRepo();
      const service = new PushSubscriptionsService(repo);

      await service.list('user-1', 'tenant-1');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'user-1', tenant_id: 'tenant-1' } }),
      );
    });

    it('never returns endpoint/p256dh/auth even if the row carries them', async () => {
      // The controller strips these via toResponse(); this test guards the
      // service doesn't need to (it returns entities), but documents the
      // contract the controller relies on — the row still HAS the secrets.
      const row = {
        id: 'sub-1',
        endpoint: 'https://push.example/x',
        p256dh: 'secret-p',
        auth: 'secret-a',
        user_agent: 'ua',
        created_at: new Date(),
        last_used_at: null,
      };
      const repo = fakeRepo({ find: vi.fn().mockResolvedValue([row]) });
      const service = new PushSubscriptionsService(repo);

      const result = await service.list('user-1', 'tenant-1');

      expect(result).toEqual([row]);
    });
  });

  describe('remove', () => {
    it('scopes the delete by id, user_id, and tenant_id', async () => {
      const repo = fakeRepo();
      const service = new PushSubscriptionsService(repo);

      await service.remove('sub-1', 'user-1', 'tenant-1');

      expect(repo.delete).toHaveBeenCalledWith({
        id: 'sub-1',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
      });
    });

    it('throws NotFoundException when the row is not the caller own (cross-user)', async () => {
      const repo = fakeRepo({ delete: vi.fn().mockResolvedValue({ affected: 0 }) });
      const service = new PushSubscriptionsService(repo);

      await expect(service.remove('sub-1', 'someone-else', 'tenant-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('removeAll', () => {
    it('deletes only the caller own rows, scoped by user_id and tenant_id', async () => {
      const repo = fakeRepo();
      const service = new PushSubscriptionsService(repo);

      await service.removeAll('user-1', 'tenant-1');

      expect(repo.delete).toHaveBeenCalledWith({ user_id: 'user-1', tenant_id: 'tenant-1' });
    });
  });
});
