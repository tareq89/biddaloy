/**
 * Always-mounted `aria-live="polite"` region for route changes — the SPA
 * equivalent of a server-rendered app's own page-navigate announcement,
 * which a screen reader gets for free from the browser but an SPA has to
 * build itself, since nothing else marks that the "page" changed. Same
 * `sr-only` + always-mounted shape as this package's other `aria-live`
 * regions (`data-table.tsx`, `combobox.tsx`'s `announceResults`) — mounted
 * once, content swapped, not remounted per message, since a screen reader
 * only announces a *change* to an already-present live region's content,
 * not one that appears already populated. No `role="status"` — that would
 * give it an accessible role a route's own, unrelated `role="status"`
 * alert can already collide with (e.g. `login.tsx`'s rate-limit
 * message), ambiguous for anyone querying by role; `aria-live="polite"`
 * alone is what every other region in this package uses, for the same
 * reason.
 *
 * `data-slot="route-announcer"` (same convention as `skeleton.tsx`'s
 * `data-slot="skeleton"`) exists because `[aria-live="polite"]` alone
 * isn't unique on a real page — a loading `Button`'s own live region and
 * a toast library's notification region both match it too ([8.9.7]
 * review, caught by the E2E suite once a real page had more than one).
 */
export interface RouteAnnouncerProps {
  /** The current route's announced text — typically its `<h1>`'s own
   * text. `null` renders an empty (silent) region, e.g. before the first
   * route change has happened yet. */
  message: string | null;
}

export function RouteAnnouncer({ message }: RouteAnnouncerProps) {
  return (
    <div data-slot="route-announcer" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
