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
 * is gated too; `clearAuthState()` drops it on logout, like the tenant hint.
 * Same try/catch-and-degrade shape as `tenant-storage.ts`.
 */
import { UserRole } from '@biddaloy/shared';

const STORAGE_KEY = 'biddaloy:firstPasswordRequired';

/** The roles are kept so the card can pick the right password rules after a reload. */
export function requireFirstPassword(roles: UserRole[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
  } catch {
    // No usable storage: the in-page card still blocks; only reload-proofing is lost.
  }
}

/**
 * The roles recorded by `requireFirstPassword`, or `null` when no password is
 * owed. A garbled value still gates, with `[]` (staff password rules).
 */
export function getFirstPasswordGate(): UserRole[] | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const known = Object.values(UserRole) as string[];
    return Array.isArray(parsed)
      ? parsed.filter((r): r is UserRole => typeof r === 'string' && known.includes(r))
      : [];
  } catch {
    return [];
  }
}

export function clearFirstPasswordGate(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
