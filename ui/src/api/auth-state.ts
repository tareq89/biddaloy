/**
 * In-memory auth/tenant state the axios client reads on every request.
 *
 * Deliberately a plain module-scoped holder, not a store (Zustand/Context) —
 * this package has no state-management primitive wired up yet, and the
 * client only needs three values plus one callback. A future ticket can
 * back these setters with a real store without changing this module's
 * public surface.
 */
import { clearPersistedTenant } from './tenant-storage';

let accessToken: string | null = null;
let activeTenantId: string | null = null;
let activeRole: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

/** Every setter below calls this after changing state — `ui/src/hooks/
 * auth-state.ts`'s `useAccessToken`/`useActiveTenant`/`useActiveRole` are
 * `useSyncExternalStore` subscribers built on it, so a tenant switch, token
 * refresh, or logout re-renders every component reading one of those hooks,
 * not just the one that happened to trigger the change. This module stays a
 * plain state holder either way (see the header comment above) — this is
 * just a subscription list, not a store. */
const listeners = new Set<() => void>();

function notifyAuthStateChange(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bumped by every `clearAuthState()` — logout and a failed reactive
 * refresh alike. `client.ts`'s `postAuthRefresh` captures this before its
 * network call and only calls `setAccessToken` if it's still current, so a
 * refresh that resolves after the session was reset can't resurrect a
 * token the reset just cleared. */
let sessionGeneration = 0;

export function currentSessionGeneration(): number {
  return sessionGeneration;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  notifyAuthStateChange();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setActiveTenant(tenantId: string | null): void {
  activeTenantId = tenantId;
  notifyAuthStateChange();
}

export function getActiveTenant(): string | null {
  return activeTenantId;
}

export function setActiveRole(role: string | null): void {
  activeRole = role;
  notifyAuthStateChange();
}

export function getActiveRole(): string | null {
  return activeRole;
}

/** The consuming app registers a handler (typically a router navigation to
 * `/login`) — this package stays router-agnostic and never imports one. */
export function registerSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

export function clearAuthState(): void {
  accessToken = null;
  activeTenantId = null;
  activeRole = null;
  sessionGeneration += 1;
  // A different account can log into the same browser afterward — without
  // this, [8.9.5]'s cold-boot restore could silently pick a tenant the new
  // user happens to also belong to, one they never actually chose.
  clearPersistedTenant();
  notifyAuthStateChange();
}

/** Called exactly once per failed refresh, regardless of how many concurrent
 * requests were waiting on it — see client.ts's single-flight refresh. */
export function notifySessionExpired(): void {
  clearAuthState();
  sessionExpiredHandler?.();
}
