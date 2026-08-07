/**
 * `?tab=` as the single source of truth for which tab is active — deep-
 * linkable (a colleague can be sent a link straight to a specific
 * student's payment history) and survives refresh, since it's just a URL.
 * An unknown or missing `?tab=` value falls back to the first tab rather
 * than rendering nothing — the issue's own acceptance criterion.
 */
import { useSearchParams } from 'react-router';

export function useDetailShellTab(tabIds: readonly string[]): [string, (tabId: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const firstTab = tabIds[0] ?? '';

  const raw = searchParams.get('tab');
  const activeTab = raw !== null && tabIds.includes(raw) ? raw : firstTab;

  function setTab(tabId: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tabId);
      return next;
    });
  }

  return [activeTab, setTab];
}
