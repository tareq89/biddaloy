/**
 * Persists the user's explicit dark-mode choice. Mirrors
 * `ui/src/i18n/locale-storage.ts`'s shape (try/catch localStorage, a
 * `biddaloy:*` key, a `clearPersisted*` used by `cleanupTestState()`) so the
 * two persistence stories read the same way rather than inventing a second
 * mechanism.
 *
 * The model is deliberately tri-state in *behavior* but binary in
 * *storage*: a user can be following the OS (`prefers-color-scheme`), or
 * have explicitly chosen `light`, or have explicitly chosen `dark`. Storage
 * only ever needs to answer "did they choose?" — `getPersistedTheme()`
 * returns `null` for "no, follow the system" rather than inventing a third
 * stored value like `'system'`. `resolveTheme()` below is where the two
 * signals (stored choice, OS preference) combine into the one `Theme` a
 * caller actually renders.
 *
 * `client-admin/index.html`'s inline boot script re-implements the read
 * half of this in plain JS (no bundler runs before it) to avoid a flash of
 * the wrong theme on first paint — see that file's own comment, which
 * cross-references this one. Keep the two in sync by hand if `STORAGE_KEY`
 * or the resolution rule ever changes.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'biddaloy:theme';

function isTheme(value: string | null | undefined): value is Theme {
  return value === 'light' || value === 'dark';
}

/** Reads the persisted explicit choice, if any. `null` means "no explicit
 * choice was ever stored" — the caller should fall back to
 * `prefers-color-scheme` via `resolveTheme()`, not treat `null` as an error.
 * Also returns `null` on a corrupted/foreign value or an environment
 * without usable storage (SSR, a locked-down webview), same reasoning as
 * `locale-storage.ts`'s `getPersistedLocale`: losing persistence is fine,
 * throwing mid-render is not. */
export function getPersistedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Persists an explicit choice. A silent no-op if storage throws (quota
 * exceeded, disabled storage, ...) — same reasoning as
 * `persistLocale`. */
export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Losing persistence is fine; throwing over it mid-render is not.
  }
}

/** Forgets the explicit choice, so the next read falls back to
 * `prefers-color-scheme` again. Exists for `cleanupTestState()` — the
 * storage key is private to this module, and a test helper holding the
 * literal string would silently drift the moment it changed here. */
export function clearPersistedTheme(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as above — an environment without usable storage has
    // nothing to clear.
  }
}

/** Combines a persisted choice with the OS preference into the one `Theme`
 * that actually gets rendered. An explicit choice always wins; `stored ===
 * null` is the only case where `systemPrefersDark` gets a vote. */
export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  return stored ?? (systemPrefersDark ? 'dark' : 'light');
}
