/**
 * Persists the chosen active tenant across a reload — [8.9.5]'s "choice
 * survives reload" AC. Mirrors `ui/src/i18n/locale-storage.ts`'s shape:
 * same try/catch-and-degrade reasoning (a user in private browsing, or any
 * environment where `localStorage` throws, just loses persistence rather
 * than crashing mid-render).
 *
 * Not a credential — a UUID hint for which tenant to restore on cold boot.
 * The access token itself stays memory-only (see `02-auth-and-multitenancy.md`);
 * `session.ts`'s bootstrap only trusts a persisted value that also appears
 * in the *fresh* memberships decoded off a just-refreshed token, and
 * `ContextGuard` is the actual server-side enforcement boundary regardless.
 */

const STORAGE_KEY = 'biddaloy:activeTenant';

export function getPersistedTenant(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistTenant(tenantId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, tenantId);
  } catch {
    // Losing persistence is fine; throwing mid-render isn't.
  }
}

/** Forgets the persisted choice — called on logout/session-clear so a
 * later cold boot for a different account doesn't restore a stale tenant.
 * Exists as its own function (not inlined at call sites) for the same
 * reason `clearPersistedLocale` does: the storage key stays a private
 * module detail instead of a literal string callers or tests would drift
 * from the moment it changes here. */
export function clearPersistedTenant(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as above — an environment without usable storage has
    // nothing to clear.
  }
}
