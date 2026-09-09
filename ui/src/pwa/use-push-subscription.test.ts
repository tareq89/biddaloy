import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { usePushSubscription } from './use-push-subscription';

const PUBLIC_KEY = 'BExampleBase64UrlSafeVapidPublicKey_-1234567890';

function mockPushManager(overrides: Partial<PushManager> = {}) {
  const subscription = {
    endpoint: 'https://push.example.com/abc',
    toJSON: () => ({
      endpoint: 'https://push.example.com/abc',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  const subscribe = vi.fn().mockResolvedValue(subscription);
  const getSubscription = vi.fn().mockResolvedValue(null);
  const pushManager = { subscribe, getSubscription, ...overrides } as unknown as PushManager;
  // Returned alongside `pushManager` (not read back off it) so assertions
  // reference the `vi.fn()` directly instead of a property read on a
  // typed method — `@typescript-eslint/unbound-method` flags the latter.
  return { pushManager, subscribe, getSubscription };
}

function installServiceWorkerAndPushManager(pushManager: PushManager) {
  Object.defineProperty(window, 'PushManager', {
    value: function PushManager() {},
    configurable: true,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
}

function removeServiceWorkerAndPushManager() {
  Object.defineProperty(window, 'PushManager', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
}

function mockNotification(
  permission: NotificationPermission,
  requestResult?: NotificationPermission,
) {
  const requestPermission = vi.fn().mockResolvedValue(requestResult ?? permission);
  Object.defineProperty(window, 'Notification', {
    value: { permission, requestPermission },
    configurable: true,
    writable: true,
  });
  return requestPermission;
}

describe('usePushSubscription', () => {
  afterEach(() => {
    removeServiceWorkerAndPushManager();
    vi.restoreAllMocks();
  });

  it('reports unsupported when PushManager/serviceWorker are absent', () => {
    removeServiceWorkerAndPushManager();
    Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });

    const { result } = renderHookWithProviders(() => usePushSubscription(), {
      tenantId: 'tenant-1',
    });

    expect(result.current.permission).toBe('unsupported');
  });

  it('reports the browser permission state when supported', () => {
    installServiceWorkerAndPushManager(mockPushManager().pushManager);
    mockNotification('default');

    const { result } = renderHookWithProviders(() => usePushSubscription(), {
      tenantId: 'tenant-1',
    });

    expect(result.current.permission).toBe('default');
  });

  it('never calls Notification.requestPermission on mount', () => {
    installServiceWorkerAndPushManager(mockPushManager().pushManager);
    const requestPermission = mockNotification('default');

    renderHookWithProviders(() => usePushSubscription(), { tenantId: 'tenant-1' });

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('subscribe() requests permission, subscribes, and posts the subscription', async () => {
    const { pushManager, subscribe } = mockPushManager();
    installServiceWorkerAndPushManager(pushManager);
    const requestPermission = mockNotification('default', 'granted');

    let posted: unknown = null;
    server.use(
      http.get('/api/v1/me/push/public-key', () =>
        HttpResponse.json({ enabled: true, public_key: PUBLIC_KEY }),
      ),
      http.post('/api/v1/me/push/subscriptions', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { id: 'sub-1', user_agent: null, created_at: '2026-01-01', last_used_at: null },
          { status: 201 },
        );
      }),
      http.get('/api/v1/me/push/subscriptions', () =>
        HttpResponse.json([
          { id: 'sub-1', user_agent: null, created_at: '2026-01-01', last_used_at: null },
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => usePushSubscription(), {
      tenantId: 'tenant-1',
    });

    await result.current.subscribe();

    await waitFor(() => {
      expect(result.current.isSubscribedOnThisDevice).toBe(true);
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(posted).toMatchObject({ endpoint: 'https://push.example.com/abc' });
  });

  it('subscribe() does nothing further when permission is denied', async () => {
    const { pushManager, subscribe } = mockPushManager();
    installServiceWorkerAndPushManager(pushManager);
    mockNotification('default', 'denied');

    const { result } = renderHookWithProviders(() => usePushSubscription(), {
      tenantId: 'tenant-1',
    });

    await result.current.subscribe();

    expect(subscribe).not.toHaveBeenCalled();
    expect(result.current.isSubscribedOnThisDevice).toBe(false);
  });

  it('unsubscribe() deletes the subscription and updates local state', async () => {
    installServiceWorkerAndPushManager(mockPushManager().pushManager);
    mockNotification('granted');

    let deleted = false;
    server.use(
      http.get('/api/v1/me/push/subscriptions', () =>
        HttpResponse.json([
          { id: 'sub-1', user_agent: 'Chrome', created_at: '2026-01-01', last_used_at: null },
        ]),
      ),
      http.delete('/api/v1/me/push/subscriptions/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHookWithProviders(() => usePushSubscription(), {
      tenantId: 'tenant-1',
    });

    await result.current.refresh();
    await waitFor(() => expect(result.current.subscriptions).not.toBeNull());

    await result.current.unsubscribe('sub-1');

    expect(deleted).toBe(true);
    await waitFor(() => {
      expect(result.current.subscriptions).toEqual([]);
    });
    expect(result.current.isSubscribedOnThisDevice).toBe(false);
  });

  it("unsubscribe() of another device does not revoke this device's own browser subscription", async () => {
    // [thread coderabbitai#14] Only the id `subscribe()` got back for this
    // device may trigger a browser-level unsubscribe/`isSubscribedOnThisDevice`
    // reset — removing a different device's row must leave this device alone.
    const { pushManager, subscribe: browserSubscribe, getSubscription } = mockPushManager();
    installServiceWorkerAndPushManager(pushManager);
    mockNotification('default', 'granted');

    server.use(
      http.get('/api/v1/me/push/public-key', () =>
        HttpResponse.json({ enabled: true, public_key: PUBLIC_KEY }),
      ),
      http.post('/api/v1/me/push/subscriptions', () =>
        HttpResponse.json(
          { id: 'this-device', user_agent: null, created_at: '2026-01-01', last_used_at: null },
          { status: 201 },
        ),
      ),
      http.get('/api/v1/me/push/subscriptions', () =>
        HttpResponse.json([
          { id: 'this-device', user_agent: null, created_at: '2026-01-01', last_used_at: null },
          {
            id: 'other-device',
            user_agent: 'Firefox',
            created_at: '2026-01-02',
            last_used_at: null,
          },
        ]),
      ),
      http.delete(
        '/api/v1/me/push/subscriptions/:id',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    const { result } = renderHookWithProviders(() => usePushSubscription(), {
      tenantId: 'tenant-1',
    });

    await result.current.subscribe();
    await waitFor(() => expect(result.current.isSubscribedOnThisDevice).toBe(true));
    expect(result.current.thisDeviceSubscriptionId).toBe('this-device');
    browserSubscribe.mockClear();

    await result.current.unsubscribe('other-device');

    await waitFor(() => {
      expect(result.current.subscriptions).toEqual([
        { id: 'this-device', user_agent: null, created_at: '2026-01-01', last_used_at: null },
      ]);
    });
    expect(getSubscription).not.toHaveBeenCalled();
    expect(result.current.isSubscribedOnThisDevice).toBe(true);
    expect(result.current.thisDeviceSubscriptionId).toBe('this-device');
  });

  it('refresh() surfaces a translation key on failure', async () => {
    installServiceWorkerAndPushManager(mockPushManager().pushManager);
    mockNotification('granted');

    server.use(
      http.get('/api/v1/me/push/subscriptions', () => HttpResponse.json({}, { status: 500 })),
    );

    const { result } = renderHookWithProviders(() => usePushSubscription(), {
      tenantId: 'tenant-1',
    });

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.error).toBe('push.errors.listFailed');
    });
  });
});
