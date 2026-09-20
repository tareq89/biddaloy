/**
 * [30.4.1] Local-only "recently opened" ring buffer for `CommandPalette`'s
 * People tab (D10). This is a convenience for the current device, not
 * synced data: it stores just enough to render a result row (`groupId` +
 * `resultId` the caller's own `onSelect` already understands, plus the
 * label/description already shown once when the item was picked) — never
 * a re-fetch of the entity itself, and never anything a lost browser
 * profile would need recovering.
 *
 * Read-in-initializer / write-in-effect / try-catch-and-degrade — same
 * shape as `app-shell.tsx`'s `readGroupCollapsed` (nav-group collapse
 * state), for the same reason: a blocked or full `localStorage` (private
 * browsing, quota) should degrade to "no recents" rather than throw and
 * take the whole palette down with it.
 */
import * as React from 'react';

import { useActiveTenant, useCurrentUserId } from './auth-state';

const STORAGE_KEY_PREFIX = 'command-palette:recent-items:v1';
const MAX_ITEMS = 8;

/**
 * The buffer is shared-device safe only if it's scoped per (tenant, user):
 * school offices routinely share a browser profile across staff and across
 * a tenant switch, and recent-item rows carry real student/guardian names.
 * An unscoped key would leak one viewer's search history — labels and
 * descriptions of who they looked up — to the next person on the same
 * machine. `null` segments (logged out, or `useCurrentUserId`'s decode
 * failure) collapse to a shared anonymous bucket rather than throwing;
 * that bucket is never written to real entity data since the palette
 * itself requires an authenticated session to render results.
 */
function storageKey(tenantId: string | null, userId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${tenantId ?? 'anon'}:${userId ?? 'anon'}`;
}

export interface RecentItem {
  /** `${groupId}:${resultId}` — dedupe/move-to-front key. */
  id: string;
  groupId: string;
  resultId: string;
  label: string;
  description?: string;
}

function readRecentItems(key: string): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentItem[]) : [];
  } catch {
    // Blocked storage (private browsing) or corrupt JSON — recents are a
    // local convenience only, never worth surfacing an error for.
    return [];
  }
}

function writeRecentItems(key: string, items: RecentItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage blocked or full — drop the write silently, same reasoning
    // as the read above.
  }
}

export interface UseRecentItemsResult {
  recentItems: readonly RecentItem[];
  /** Moves the item to front if already present, caps at `MAX_ITEMS`. */
  addRecentItem: (item: RecentItem) => void;
}

interface RecentItemsState {
  key: string;
  items: RecentItem[];
}

export function useRecentItems(): UseRecentItemsResult {
  const tenantId = useActiveTenant();
  const userId = useCurrentUserId();
  const key = storageKey(tenantId, userId);

  // `key` and `items` move together in one state value, not two separate
  // ones — that's load-bearing, not style. With a ref-tracked key and a
  // sibling `items` state (the previous shape here), React runs both the
  // re-read effect and the write effect in the same commit when `key`
  // changes: the re-read effect updates the ref synchronously and schedules
  // a state update for the next render, but the write effect — running in
  // the same pass, still seeing the *old* `items` — reads the now-updated
  // ref, sees it matches the new `key`, and persists the outgoing viewer's
  // recents into the incoming viewer's storage slot before the re-read's
  // state update ever lands. Keeping `key` and `items` in one object makes
  // that pairing atomic: there is no render where a stale `items` array is
  // paired with the new `key`.
  const [state, setState] = React.useState<RecentItemsState>(() => ({
    key,
    items: readRecentItems(key),
  }));

  // Re-read when the scope key changes so a shared device never shows the
  // previous viewer's recents.
  React.useEffect(() => {
    setState({ key, items: readRecentItems(key) });
  }, [key]);

  // The write lives here, not inside `addRecentItem` directly — same
  // reasoning as `app-shell.tsx`'s `NavGroupSection` comment: keeping the
  // state update and the persistence as two separate steps means a test
  // (or a future caller) can assert on `recentItems` without also having
  // to stub `localStorage`. Guarded on `state.key === key`, the same
  // atomic pairing above, so this never fires for a state slice that
  // hasn't caught up to the current viewer yet.
  React.useEffect(() => {
    if (state.key !== key) return;
    writeRecentItems(state.key, state.items);
  }, [key, state]);

  const addRecentItem = React.useCallback(
    (item: RecentItem) => {
      setState((previous) => {
        if (previous.key !== key) return previous;
        const deduped = previous.items.filter((existing) => existing.id !== item.id);
        return { key, items: [item, ...deduped].slice(0, MAX_ITEMS) };
      });
    },
    [key],
  );

  // Never return a previous viewer's items — even for the one render where
  // `key` has changed but the re-read effect above hasn't committed yet.
  const recentItems = state.key === key ? state.items : [];

  return { recentItems, addRecentItem };
}
