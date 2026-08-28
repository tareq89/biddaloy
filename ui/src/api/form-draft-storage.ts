/**
 * [8.12.3] Tenant scoping and purging for `useFormAutosave`'s drafts.
 *
 * The drafts themselves are not new — `useFormAutosave`
 * (`ui/src/shells/use-form-shell.ts`, [8.3.x]) has always persisted them
 * to `localStorage` and restored them on demand. Two real bugs were:
 *
 * 1. **The key was not tenant-scoped.** Every "new student" form on the
 *    origin shared `form-shell-draft:student-new`, so an administrator of
 *    two schools who abandoned a half-filled form at school A was offered
 *    it back — silently, as their own work — while working in school B.
 *    Now the active tenant is part of the key, so the two never meet.
 * 2. **Nothing purged them at logout.** The next person at the same
 *    browser could restore a stranger's half-typed student record.
 *    `clearAuthState()` now calls `clearAllFormDrafts()`.
 *
 * Drafts stay in `localStorage` rather than moving into the Dexie store:
 * `useFormAutosave`'s surface is synchronous (`restoreDraft()` returns
 * values, `draftAvailable` is known at mount), and IndexedDB is not.
 * Rewriting a working feature into an async one to share a storage engine
 * would be a change with cost and no user-visible benefit.
 */
/** Shared prefix so `clearAllFormDrafts` can find every draft regardless
 * of which tenant or form wrote it. */
export const FORM_DRAFT_KEY_PREFIX = 'form-shell-draft:';

/**
 * `form-shell-draft:<tenantId>:<formKey>`.
 *
 * Falls back to a literal `no-tenant` segment before a tenant is chosen —
 * the pre-tenant surface is only `/login` and `/select-school`, neither of
 * which autosaves, but a key that silently collapsed to the unscoped shape
 * would reintroduce bug 1 above for anything that later did.
 *
 * The tenant is a parameter rather than read from `auth-state` here: that
 * import made a cycle (`auth-state` calls `clearAllFormDrafts` below), and
 * a cycle through the module that decides which tenant's data a key
 * addresses is not somewhere to rely on hoisting order.
 */
export function formDraftKey(formKey: string, tenantId: string | null): string {
  return `${FORM_DRAFT_KEY_PREFIX}${tenantId ?? 'no-tenant'}:${formKey}`;
}

/**
 * Removes every autosaved draft on this origin, for every tenant. Called
 * from `clearAuthState()` — the same funnel logout, session expiry and a
 * failed refresh all pass through.
 *
 * Silent on a blocked/unavailable `localStorage`, matching the rest of the
 * autosave feature: a browser that cannot read storage has no drafts to
 * leak in the first place.
 */
export function clearAllFormDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(FORM_DRAFT_KEY_PREFIX)) keys.push(key);
    }
    // Collected first, removed after: removing during the walk shifts
    // every later index down and silently skips half the drafts.
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // See this function's own comment.
  }
}
