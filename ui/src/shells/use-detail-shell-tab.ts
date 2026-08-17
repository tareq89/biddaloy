/**
 * `?tab=` as the single source of truth for which tab is active — deep-
 * linkable (a colleague can be sent a link straight to a specific
 * student's payment history) and survives refresh, since it's just a URL.
 * An unknown or missing `?tab=` value falls back to the first tab rather
 * than rendering nothing — the issue's own acceptance criterion. `setTab`
 * rejects a tab id that isn't in `tabIds` rather than writing it to the
 * URL and relying on the same fallback to paper over it on next read —
 * the visible tab strip and the URL should never disagree, even for one
 * render.
 */
import { useSearch } from '@tanstack/react-router';

import { useSearchNavigate } from '../routes/navigate-search';

export function useDetailShellTab(tabIds: readonly string[]): [string, (tabId: string) => void] {
  // `strict: false` — this hook has no fixed route id, same reasoning as
  // `useListUrlState` (see its own comment).
  const search = useSearch({ strict: false }) as unknown as Record<string, unknown>;
  const navigateSearch = useSearchNavigate();
  const firstTab = tabIds[0] ?? '';

  const raw = search.tab;
  const activeTab = typeof raw === 'string' && tabIds.includes(raw) ? raw : firstTab;

  function setTab(tabId: string): void {
    if (!tabIds.includes(tabId)) return;
    navigateSearch((prev) => ({ ...prev, tab: tabId }));
  }

  return [activeTab, setTab];
}
