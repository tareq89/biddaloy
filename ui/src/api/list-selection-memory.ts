/**
 * [2602] In-memory home for a list's cross-page row selection. It used to
 * ride in the URL (`?selected=<id>,<id>,…`); a few hundred ids made the URL
 * too long for the server and a refresh answered 431/414 with a blank page.
 * In memory: Back inside the app keeps the selection, a refresh drops it,
 * and no URL ever carries it. Deliberately not `sessionStorage` (D9).
 *
 * Key = `<tenantId>:<pathname>`, built by the caller. The tenant is a
 * parameter, not read here, for the same reason as `formDraftKey` in
 * `form-draft-storage.ts`: `auth-state` calls `clearListSelectionMemory`,
 * so importing it back would make a cycle through the module that decides
 * which tenant's data a key addresses.
 */
const selections = new Map<string, ReadonlySet<string>>();

export function listSelectionKey(pathname: string, tenantId: string | null): string {
  return `${tenantId ?? 'no-tenant'}:${pathname}`;
}

export function getSelection(key: string): ReadonlySet<string> {
  return selections.get(key) ?? new Set();
}

export function setSelection(key: string, ids: ReadonlySet<string>): void {
  if (ids.size === 0) selections.delete(key);
  else selections.set(key, ids);
}

/** Called from `clearAuthState()` so the next account starts clean. */
export function clearListSelectionMemory(): void {
  selections.clear();
}
