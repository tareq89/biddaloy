import { describe, it, expect, vi } from 'vitest';
import { PushSubscriptionsController } from './push-subscriptions.controller';

function fakePushConfig(overrides: Partial<Record<string, any>> = {}) {
  return {
    isPushEnabled: vi.fn().mockReturnValue(true),
    getVapidPublicKey: vi.fn().mockReturnValue('public-key'),
    ...overrides,
  } as any;
}

function fakeSubscriptionsService(overrides: Partial<Record<string, any>> = {}) {
  return {
    subscribe: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    remove: vi.fn(),
    removeAll: vi.fn(),
    ...overrides,
  } as any;
}

/**
 * [#553] Controller-level checks that the response shape never leaks
 * secrets, and that every service call is scoped by the caller's own
 * user + tenant taken from the decorators — never a body/query param.
 */
describe('PushSubscriptionsController', () => {
  describe('getPublicKey', () => {
    it('reports enabled: false and public_key: null when push is disabled', () => {
      const controller = new PushSubscriptionsController(
        fakePushConfig({ isPushEnabled: vi.fn().mockReturnValue(false) }),
        fakeSubscriptionsService(),
      );

      expect(controller.getPublicKey()).toEqual({ enabled: false, public_key: null });
    });

    it('reports the VAPID public key when push is enabled', () => {
      const controller = new PushSubscriptionsController(
        fakePushConfig(),
        fakeSubscriptionsService(),
      );

      expect(controller.getPublicKey()).toEqual({ enabled: true, public_key: 'public-key' });
    });
  });

  describe('subscribe', () => {
    it('passes the caller user/tenant id (from decorators) and the request user-agent to the service', async () => {
      const subscriptions = fakeSubscriptionsService({
        subscribe: vi.fn().mockResolvedValue({
          id: 'sub-1',
          endpoint: 'https://push.example/x',
          p256dh: 'secret-p',
          auth: 'secret-a',
          user_agent: 'test-agent',
          created_at: new Date('2026-01-01'),
          last_used_at: null,
        }),
      });
      const controller = new PushSubscriptionsController(fakePushConfig(), subscriptions);
      const dto = { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } };
      const req = { headers: { 'user-agent': 'test-agent' }, ip: '127.0.0.1' } as any;

      const result = await controller.subscribe(
        dto,
        { sub: 'user-1' } as any,
        { id: 'tenant-1', role: 'PARENT' } as any,
        req,
      );

      expect(subscriptions.subscribe).toHaveBeenCalledWith('user-1', 'tenant-1', dto, 'test-agent');
      // Secrets never echoed back.
      expect(result).not.toHaveProperty('endpoint');
      expect(result).not.toHaveProperty('keys');
      expect(result).not.toHaveProperty('p256dh');
      expect(result).not.toHaveProperty('auth');
      expect(result).toEqual({
        id: 'sub-1',
        user_agent: 'test-agent',
        created_at: new Date('2026-01-01'),
        last_used_at: null,
      });
    });
  });

  describe('list', () => {
    it('only asks the service for the current caller tenant (cross-tenant rows never requested)', async () => {
      const subscriptions = fakeSubscriptionsService({ list: vi.fn().mockResolvedValue([]) });
      const controller = new PushSubscriptionsController(fakePushConfig(), subscriptions);

      const result = await controller.list(
        { sub: 'user-1' } as any,
        { id: 'tenant-a', role: 'PARENT' } as any,
      );

      expect(subscriptions.list).toHaveBeenCalledWith('user-1', 'tenant-a');
      // A user with no rows under this tenant gets an empty list, not
      // another tenant's data.
      expect(result).toEqual([]);
    });

    it('strips endpoint/keys from every row in the response', async () => {
      const subscriptions = fakeSubscriptionsService({
        list: vi.fn().mockResolvedValue([
          {
            id: 'sub-1',
            endpoint: 'https://push.example/x',
            p256dh: 'secret-p',
            auth: 'secret-a',
            user_agent: 'ua',
            created_at: new Date('2026-01-01'),
            last_used_at: null,
          },
        ]),
      });
      const controller = new PushSubscriptionsController(fakePushConfig(), subscriptions);

      const result = await controller.list(
        { sub: 'user-1' } as any,
        {
          id: 'tenant-1',
          role: 'PARENT',
        } as any,
      );

      expect(result).toEqual([
        { id: 'sub-1', user_agent: 'ua', created_at: new Date('2026-01-01'), last_used_at: null },
      ]);
    });
  });

  describe('remove', () => {
    it('delegates to the service with id + caller user/tenant (service enforces own-only 404)', async () => {
      const subscriptions = fakeSubscriptionsService();
      const controller = new PushSubscriptionsController(fakePushConfig(), subscriptions);

      await controller.remove(
        'sub-1',
        { sub: 'user-1' } as any,
        { id: 'tenant-1', role: 'PARENT' } as any,
      );

      expect(subscriptions.remove).toHaveBeenCalledWith('sub-1', 'user-1', 'tenant-1');
    });
  });

  describe('removeAll', () => {
    it('delegates to the service scoped to the caller user/tenant', async () => {
      const subscriptions = fakeSubscriptionsService();
      const controller = new PushSubscriptionsController(fakePushConfig(), subscriptions);

      await controller.removeAll(
        { sub: 'user-1' } as any,
        { id: 'tenant-1', role: 'PARENT' } as any,
      );

      expect(subscriptions.removeAll).toHaveBeenCalledWith('user-1', 'tenant-1');
    });
  });
});
