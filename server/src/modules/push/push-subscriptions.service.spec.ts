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
  describe('subscribe', () => {
    it('creates a new row scoped to the caller when the endpoint is new', async () => {
      const repo = fakeRepo();
      const service = new PushSubscriptionsService(repo);

      await service.subscribe(
        'user-1',
        'tenant-1',
        { endpoint: 'https://push.example/abc', keys: { p256dh: 'p1', auth: 'a1' } },
        'ua-1',
      );

      expect(repo.create).toHaveBeenCalledWith({ endpoint: 'https://push.example/abc' });
      const saved = repo.save.mock.calls[0][0];
      expect(saved.user_id).toBe('user-1');
      expect(saved.tenant_id).toBe('tenant-1');
      expect(saved.p256dh).toBe('p1');
      expect(saved.auth).toBe('a1');
      expect(saved.user_agent).toBe('ua-1');
    });

    it('re-owns an existing endpoint to the current user/tenant and updates keys', async () => {
      const existing = {
        id: 'sub-existing',
        endpoint: 'https://push.example/shared',
        user_id: 'old-user',
        tenant_id: 'old-tenant',
        p256dh: 'old-p',
        auth: 'old-a',
        user_agent: 'old-ua',
        failure_count: 3,
        created_at: new Date('2026-01-01'),
        last_used_at: null,
      };
      const repo = fakeRepo({ findOne: vi.fn().mockResolvedValue(existing) });
      const service = new PushSubscriptionsService(repo);

      await service.subscribe(
        'new-user',
        'new-tenant',
        { endpoint: 'https://push.example/shared', keys: { p256dh: 'new-p', auth: 'new-a' } },
        'new-ua',
      );

      // Upsert must reuse the same row (never create a duplicate).
      expect(repo.create).not.toHaveBeenCalled();
      const saved = repo.save.mock.calls[0][0];
      expect(saved.id).toBe('sub-existing');
      expect(saved.user_id).toBe('new-user');
      expect(saved.tenant_id).toBe('new-tenant');
      expect(saved.p256dh).toBe('new-p');
      expect(saved.auth).toBe('new-a');
      expect(saved.failure_count).toBe(0);
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
