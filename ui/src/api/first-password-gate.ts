/**
 * [13.5.3] Client-side stop-gap for "staff must set a password before using
 * the app". A first code sign-in (`verifyOtp` / `verifyRegistration`) already
 * holds a full session when it shows the "set a password" card, so a reload
 * or a second tab would otherwise skip that card. The caller records the
 * gate here; `_staff`'s `beforeLoad` sends the user back to the card while
 * it is set.
 *
 * Not a security boundary: the server does not enforce `password_required`
 * yet (follow-up issue). `localStorage`, not `sessionStorage`, so a new tab
 * is gated too; `clearAuthState()` drops it on logout, like the tenant hint,
 * and a record for a different signed-in account is ignored.
 * Same try/catch-and-degrade shape as `tenant-storage.ts`.
 */
import { UserRole } from '@biddaloy/shared';

import { getAccessToken } from './auth-state';
import { decodeAccessTokenSubject } from './session';

const STORAGE_KEY = 'biddaloy:firstPasswordRequired';

/** Who is signed in now, by the access token's `sub` (`null` when it has none). */
function currentSub(): string | null {
  const token = getAccessToken();
  return token ? decodeAccessTokenSubject(token) : null;
}

/**
 * Records that the signed-in account owes a password. Keyed by its `sub`, so
 * another account signing in on this browser later is not gated by it. The
 * roles are kept so the card can pick the right password rules after a reload.
 */
export function requireFirstPassword(roles: UserRole[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sub: currentSub(), roles }));
  } catch {
    // No usable storage: the in-page card still blocks; only reload-proofing is lost.
  }
}

/**
 * The roles recorded by `requireFirstPassword`, or `null` when no password is
 * owed: nothing recorded, no session, or a record for another account (which
 * is dropped). A garbled value is dropped too.
 */
export function getFirstPasswordGate(): UserRole[] | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null || !getAccessToken()) return null;
  let gate: { sub?: unknown; roles?: unknown } | null = null;
  try {
    gate = JSON.parse(raw) as { sub?: unknown; roles?: unknown } | null;
  } catch {
    // Dropped below.
  }
  if (typeof gate !== 'object' || gate === null || gate.sub !== currentSub()) {
    clearFirstPasswordGate();
    return null;
  }
  const known = Object.values(UserRole) as string[];
  return Array.isArray(gate.roles)
    ? gate.roles.filter((r): r is UserRole => typeof r === 'string' && known.includes(r))
    : [];
}

export function clearFirstPasswordGate(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
