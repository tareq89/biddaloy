/**
 * In-memory auth/tenant state the axios client reads on every request.
 *
 * Deliberately a plain module-scoped holder, not a store (Zustand/Context) —
 * this package has no state-management primitive wired up yet, and the
 * client only needs three values plus one callback. A future ticket can
 * back these setters with a real store without changing this module's
 * public surface.
 */

let accessToken: string | null = null;
let activeTenantId: string | null = null;
let activeRole: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

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
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setActiveTenant(tenantId: string | null): void {
  activeTenantId = tenantId;
}

export function getActiveTenant(): string | null {
  return activeTenantId;
}

export function setActiveRole(role: string | null): void {
  activeRole = role;
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
}

/** Called exactly once per failed refresh, regardless of how many concurrent
 * requests were waiting on it — see client.ts's single-flight refresh. */
export function notifySessionExpired(): void {
  clearAuthState();
  sessionExpiredHandler?.();
}
