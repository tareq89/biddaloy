import * as React from 'react';

import {
  getAccessToken,
  getActiveRole,
  getActiveTenant,
  subscribeAuthState,
} from '../api/auth-state';
import { decodeAccessTokenSubject } from '../api/session';

/**
 * Reactive counterparts to `auth-state.ts`'s plain getters, built on
 * `useSyncExternalStore` over that module's `subscribeAuthState`. A tenant
 * switch, token refresh, or logout now re-renders every component reading
 * one of these — not just the one that happened to trigger the change (a
 * `TenantBar` switch previously only updated its own local state; see its
 * own comment, now out of date). `useHasPermission` (`permissions.ts`)
 * is built on `useActiveRole` for the same reason.
 */
export function useAccessToken(): string | null {
  return React.useSyncExternalStore(subscribeAuthState, getAccessToken);
}

export function useActiveTenant(): string | null {
  return React.useSyncExternalStore(subscribeAuthState, getActiveTenant);
}

export function useActiveRole(): string | null {
  return React.useSyncExternalStore(subscribeAuthState, getActiveRole);
}

/** The logged-in user's own id, decoded from the access token's `sub`
 * claim ([8.11.8]'s "you cannot remove your own account" guard). `null`
 * while logged out or for a malformed token — callers treat that as "not
 * self", which fails safe: the server's own self-removal 400 is the real
 * boundary either way. */
export function useCurrentUserId(): string | null {
  const token = useAccessToken();
  return token === null ? null : decodeAccessTokenSubject(token);
}
