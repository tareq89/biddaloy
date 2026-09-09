/**
 * [15.7.6] Web push opt-in state for the guardian portal — permission
 * state, subscribe/unsubscribe against `server/src/modules/push`'s `/me/push`
 * routes, and the caller's current list of subscriptions.
 *
 * Hand-typed request helpers, not `ui/src/api/schema.d.ts` — the push
 * routes aren't in the generated OpenAPI types yet (`schema.d.ts` is
 * generated from `server/openapi.json`, off-limits to this ticket).
 * **Follow-up for whoever next regenerates `schema.d.ts`:** once it picks
 * up `GET /me/push/public-key`, `POST /me/push/subscriptions`,
 * `GET /me/push/subscriptions`, `DELETE /me/push/subscriptions/:id`, this
 * hook's three request functions below should be swapped for
 * `apiClient`-typed calls against `paths['/me/push/...']`, matching every
 * other `ui/src/api` module's pattern.
 *
 * Never calls `Notification.requestPermission()` on its own — that only
 * ever happens inside `subscribe()`, which a caller wires to a button's
 * `onClick` (the toggle, or the one-time inline card). Calling
 * `Notification.requestPermission()` outside a user gesture is what the
 * spec and every browser's own heuristics treat as an auto-block trigger,
 * and it's also just rude — see #557's own acceptance criterion.
 */
import * as React from 'react';

import { apiClient } from '../api/client';

export type PushPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export interface PushSubscriptionSummary {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface UsePushSubscriptionResult {
  /** `'unsupported'` when this browser has no `PushManager`/`serviceWorker`
   * at all — the settings page renders a plain text line, no toggle, in
   * that case. Otherwise mirrors `Notification.permission`. */
  permission: PushPermissionState;
  /** This device's own subscriptions row, tracked locally after a
   * successful `subscribe()`/`unsubscribe()` rather than matched against
   * `subscriptions` by endpoint — the server never echoes the endpoint
   * back (`PushSubscriptionResponseDto` deliberately omits it, see that
   * DTO's own comment), so there is nothing to compare against. */
  isSubscribedOnThisDevice: boolean;
  /** The `id` of this device's own subscription row, once known — set by
   * `subscribe()` from the server's response, `null` before the first
   * successful subscribe this session. Lets callers pick this device's
   * row out of `subscriptions` reliably instead of guessing by
   * `created_at`. */
  thisDeviceSubscriptionId: string | null;
  /** All of the caller's subscriptions across every device, from
   * `GET /me/push/subscriptions`. `null` until the first successful
   * `refresh()`. */
  subscriptions: PushSubscriptionSummary[] | null;
  loading: boolean;
  error: string | null;
  /** Re-fetches `subscriptions` from the server. */
  refresh: () => Promise<void>;
  /** Requests notification permission (if not already granted), then
   * subscribes this device. Only ever call this from a click handler. */
  subscribe: () => Promise<void>;
  /** Removes one subscription by id — used for the "other devices" list's
   * remove buttons. Also clears `isSubscribedOnThisDevice` when the
   * removed row is this device's own. */
  unsubscribe: (id: string) => Promise<void>;
}

function detectPermission(): PushPermissionState {
  if (
    typeof window === 'undefined' ||
    !('PushManager' in window) ||
    !('serviceWorker' in navigator) ||
    typeof Notification === 'undefined'
  ) {
    return 'unsupported';
  }
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function getPublicKey(): Promise<string | null> {
  const response = await apiClient.get<{ enabled: boolean; public_key: string | null }>(
    '/me/push/public-key',
  );
  return response.data.enabled ? response.data.public_key : null;
}

async function postSubscription(
  subscription: PushSubscriptionJSON,
): Promise<PushSubscriptionSummary> {
  const response = await apiClient.post<PushSubscriptionSummary>(
    '/me/push/subscriptions',
    subscription,
  );
  return response.data;
}

async function fetchSubscriptions(): Promise<PushSubscriptionSummary[]> {
  const response = await apiClient.get<PushSubscriptionSummary[]>('/me/push/subscriptions');
  return response.data;
}

async function deleteSubscription(id: string): Promise<void> {
  await apiClient.delete(`/me/push/subscriptions/${id}`);
}

export function usePushSubscription(): UsePushSubscriptionResult {
  const [permission, setPermission] = React.useState<PushPermissionState>(detectPermission);
  const [isSubscribedOnThisDevice, setIsSubscribedOnThisDevice] = React.useState(false);
  const [thisDeviceSubscriptionId, setThisDeviceSubscriptionId] = React.useState<string | null>(
    null,
  );
  const [subscriptions, setSubscriptions] = React.useState<PushSubscriptionSummary[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Recover this device's subscription state after a reload — subscribe()
  // only sets isSubscribedOnThisDevice/thisDeviceSubscriptionId for the
  // session it ran in, so a browser that was already subscribed would
  // otherwise report unsubscribed until the next subscribe() call.
  // `POST /me/push/subscriptions` upserts by endpoint (see the route's own
  // doc comment), so re-posting the browser's existing registration is a
  // safe way to resolve its row id, not a fresh subscribe.
  React.useEffect(() => {
    if (permission !== 'granted') return;
    let cancelled = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const pushSubscription = await registration.pushManager.getSubscription();
        if (!pushSubscription || cancelled) return;
        const row = await postSubscription(pushSubscription.toJSON());
        if (cancelled) return;
        setThisDeviceSubscriptionId(row.id);
        setIsSubscribedOnThisDevice(true);
      } catch {
        // Best-effort recovery only — a failure here just leaves the
        // toggle showing "off" until the guardian subscribes again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permission]);

  const refresh = React.useCallback(async () => {
    if (permission === 'unsupported') return;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchSubscriptions();
      setSubscriptions(rows);
    } catch {
      setError('push.errors.listFailed');
    } finally {
      setLoading(false);
    }
  }, [permission]);

  const subscribe = React.useCallback(async () => {
    if (permission === 'unsupported') return;
    setLoading(true);
    setError(null);
    try {
      let currentPermission = Notification.permission;
      if (currentPermission === 'default') {
        // The only place in this hook — indeed anywhere in this file —
        // that calls requestPermission(). Only reached from a caller's
        // button click, never on mount.
        currentPermission = await Notification.requestPermission();
        setPermission(currentPermission);
      }
      if (currentPermission !== 'granted') {
        return;
      }

      const publicKey = await getPublicKey();
      if (!publicKey) {
        setError('push.errors.disabled');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const pushSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // `Uint8Array<ArrayBufferLike>` isn't assignable to the DOM lib's
        // `BufferSource` (it wants a plain `ArrayBuffer`, not the union
        // TS infers from `new Uint8Array(n)`) — the runtime value is a
        // real BufferSource either way, so this is a lib-typing gap, not
        // an actual type mismatch.
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });
      const created = await postSubscription(pushSubscription.toJSON());
      setThisDeviceSubscriptionId(created.id);
      setIsSubscribedOnThisDevice(true);
      await refresh();
    } catch {
      setError('push.errors.subscribeFailed');
    } finally {
      setLoading(false);
    }
  }, [permission, refresh]);

  const unsubscribe = React.useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        await deleteSubscription(id);
        setSubscriptions((prev) => (prev ? prev.filter((row) => row.id !== id) : prev));
        const isThisDevice = thisDeviceSubscriptionId === id;
        // Best-effort: also unsubscribe the browser's own PushManager
        // registration, but only when this device is the one being
        // removed — otherwise removing another device's row would revoke
        // this browser's own (still-valid) push registration.
        if (isThisDevice && permission !== 'unsupported') {
          const registration = await navigator.serviceWorker.ready;
          const pushSubscription = await registration.pushManager.getSubscription();
          if (pushSubscription) {
            await pushSubscription.unsubscribe();
          }
        }
        if (isThisDevice) {
          setThisDeviceSubscriptionId(null);
          setIsSubscribedOnThisDevice(false);
        }
      } catch {
        setError('push.errors.unsubscribeFailed');
      } finally {
        setLoading(false);
      }
    },
    [permission, thisDeviceSubscriptionId],
  );

  return {
    permission,
    isSubscribedOnThisDevice,
    thisDeviceSubscriptionId,
    subscriptions,
    loading,
    error,
    refresh,
    subscribe,
    unsubscribe,
  };
}
