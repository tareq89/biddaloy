/**
 * Persists the chosen active tenant *and role* across a reload — [8.9.5]'s
 * "choice survives reload" AC, widened by [8.9.11] to the `{tenantId, role}`
 * pair a membership actually is. Mirrors `ui/src/i18n/locale-storage.ts`'s
 * shape: same try/catch-and-degrade reasoning (a user in private browsing, or
 * any environment where `localStorage` throws, just loses persistence rather
 * than crashing mid-render).
 *
 * Not a credential — a hint for which membership to restore on cold boot.
 * The access token itself stays memory-only (see `02-auth-and-multitenancy.md`);
 * `session.ts`'s bootstrap only trusts a persisted value that also appears
 * in the *fresh* memberships decoded off a just-refreshed token, and
 * `ContextGuard` is the actual server-side enforcement boundary regardless.
 *
 * Storing the role matters because one user can hold two roles at the *same*
 * school (an ADMIN who is also a PARENT there). Before [8.9.11] this stored a
 * bare tenant UUID, so a reload re-picked whichever of the two memberships the
 * token happened to list first — silently switching the user's role under them.
 */
import { UserRole } from '@biddaloy/shared';

const STORAGE_KEY = 'biddaloy:activeTenant';

export interface PersistedTenant {
  tenantId: string;
  /** `null` means exactly one thing: **this value never named a role.** A
   * bare UUID written before [8.9.11] started storing the role, or a
   * `{tenantId, role: null}` this module wrote itself for a switch that
   * didn't pass one. `session.ts` reads that as "match on tenant alone",
   * i.e. the pre-[8.9.11] behaviour, rather than discarding the choice.
   *
   * A value that *did* name a role but no longer resolves to a `UserRole`
   * (renamed, removed, hand-edited) is **not** this case — `getPersistedTenant`
   * returns `null` for the whole value instead. Folding it in here would
   * make it match on tenant alone, which restores the first role at that
   * tenant: the precise behaviour [8.9.11] exists to stop. */
  role: UserRole | null;
}

function toRole(value: unknown): UserRole | null {
  return typeof value === 'string' && (Object.values(UserRole) as string[]).includes(value)
    ? (value as UserRole)
    : null;
}

export function getPersistedTenant(): PersistedTenant | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  // A pre-[8.9.11] value is a bare UUID, which is not valid JSON — the parse
  // throws and the raw string is the tenant id. Anything that parses but
  // isn't the current shape (a hand-edited or half-written value) degrades
  // the same way rather than throwing mid-bootstrap.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { tenantId, role } = parsed as { tenantId?: unknown; role?: unknown };
      if (typeof tenantId === 'string') {
        // Written with no role at all — the roleless case, restored on
        // tenant alone.
        if (role === null) return { tenantId, role: null };
        // Named a role we can't resolve: unusable, not roleless. Dropping
        // the whole value leaves the choice unresolved, which sends the
        // user to `/select-school` to make it again.
        const knownRole = toRole(role);
        if (knownRole !== null) return { tenantId, role: knownRole };
      }
    }
    return null;
  } catch {
    return { tenantId: raw, role: null };
  }
}

export function persistTenant(tenantId: string, role?: string | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tenantId, role: role ?? null }));
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
