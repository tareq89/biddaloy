/**
 * Persists the staff member's last-picked invoice print format. Mirrors
 * `ui/src/theme/theme-storage.ts`'s shape (try/catch localStorage, a
 * `biddaloy:*` key, a `clearPersisted*` used by `cleanupTestState()`) so
 * this reads the same way as every other persisted UI preference rather
 * than inventing a second mechanism.
 *
 * Deliberately per-device, not per-user or server-synced: a counter PC
 * plugged into a 58mm POS printer should stay on `'pos58'` even after a
 * different staff member logs in on it, and a back-office desktop printing
 * A4 shouldn't inherit that choice.
 */
export type InvoicePrintFormat = 'a4' | 'pos58' | 'pos80';

const STORAGE_KEY = 'biddaloy:invoice-print-format';

function isInvoicePrintFormat(value: string | null | undefined): value is InvoicePrintFormat {
  return value === 'a4' || value === 'pos58' || value === 'pos80';
}

/** Reads the persisted format, if any. `null` means "no explicit choice
 * was ever stored" — the caller should fall back to the `'a4'` default,
 * not treat `null` as an error. Also returns `null` on a corrupted/foreign
 * value or an environment without usable storage (SSR, a locked-down
 * webview), same reasoning as `theme-storage.ts`'s `getPersistedTheme`:
 * losing persistence is fine, throwing mid-render is not. */
export function getPersistedPrintFormat(): InvoicePrintFormat | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isInvoicePrintFormat(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Persists an explicit choice. A silent no-op if storage throws (quota
 * exceeded, disabled storage, ...) — same reasoning as `persistTheme`. */
export function persistPrintFormat(format: InvoicePrintFormat): void {
  try {
    localStorage.setItem(STORAGE_KEY, format);
  } catch {
    // Losing persistence is fine; throwing over it mid-render is not.
  }
}

/** Forgets the persisted choice. Exists for `cleanupTestState()` — the
 * storage key is private to this module, and a test helper holding the
 * literal string would silently drift the moment it changed here. */
export function clearPersistedPrintFormat(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as above — an environment without usable storage has
    // nothing to clear.
  }
}
