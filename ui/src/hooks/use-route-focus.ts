/**
 * [8.9.7]'s focus-management/announcer/title logic, factored out of
 * `client-admin`'s `__root.tsx` so it stays package-agnostic (client-
 * student gets the same behaviour for free once it wires this in too).
 *
 * Triggered by the router's own `onRendered` event, not a `useEffect` on
 * `useRouterState`'s `location`/`resolvedLocation` — TanStack Router
 * commits a route change via `React.startTransition` (see `load-
 * client.js`'s `commit` in `@tanstack/router-core`), and only emits
 * `onRendered` *after* that commit actually lands, in a plain callback
 * outside React's render cycle. A `useEffect` keyed on router state can
 * fire a tick before the transition commits — reading a stale `<h1>`
 * that never gets corrected, since the dependency it's watching won't
 * change again for that navigation. `onRendered` is the exact mechanism
 * this package's own `scroll-restoration.js` uses internally for the
 * equivalent problem (restoring scroll position only once the new
 * route's DOM is real) — this hook does the same thing for focus.
 *
 * On every route render:
 * - `document.title` is set from the new route's own `<h1>` — searched
 *   inside the `mainId` landmark first, falling back to the whole
 *   `document` for the two chrome-free routes ([8.9.4]'s `/login`,
 *   [8.9.5]'s `/select-school`) that render outside `AppShell` and so
 *   have no `mainId` element at all, but do carry their own top-level
 *   `<h1>` (`SignInForm`/`SchoolPicker`'s own heading).
 * - Focus moves to that `<h1>` (or, if none exists, to the `mainId`
 *   landmark itself) — except on the very first render, where the
 *   browser's own default focus (address bar) is left alone; grabbing
 *   focus on cold load isn't a "route change" and would be surprising to
 *   a keyboard/AT visitor who didn't trigger a navigation at all.
 * - The same text is handed back for a `RouteAnnouncer` to announce.
 *
 * Returning **from** a route restores focus to a "sensible anchor"
 * rather than the new page's heading, if one was recorded — any element
 * rendered with a `data-focus-anchor` attribute (e.g. a list row's
 * `<Link>`) has its own anchor id remembered, per pathname *left*, the
 * moment it's clicked. A `BACK`/`FORWARD` history action landing back on
 * that pathname re-focuses that exact anchor if it's still in the DOM,
 * satisfying [8.9.7]'s "returning from a detail page restores focus to a
 * sensible anchor, not the top of the document" AC without every route
 * needing bespoke wiring — opting in is exactly one `data-focus-anchor`
 * attribute (see `client-admin`'s `students/index.tsx` row `<Link>`s).
 */
import { type RouterHistory, useRouter } from '@tanstack/react-router';
import * as React from 'react';

/** Module-level, not component state — this must outlive the component
 * whose route is being *left* (its DOM, and any hook state tied to it,
 * is already gone by the time a `BACK` navigation lands on it again). */
const focusAnchorMemory = new Map<string, string>();

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value;
}

export interface UseRouteFocusOptions {
  /** `id` of the route content landmark (`AppShell`'s `<main>`) — see
   * `APP_SHELL_MAIN_ID` (`./app-shell.tsx`), which both this hook's own
   * caller and `AppShell` itself should use, so they never drift apart. */
  mainId: string;
  /** Appended to the found `<h1>` for `document.title`, e.g. `Biddaloy`
   * — passed in rather than read via `useTranslation` here so this hook
   * stays translation-library-agnostic. */
  appName: string;
}

/** The current route's announced text for a `RouteAnnouncer` — `null`
 * before the first real route change (see the module doc above). */
export function useRouteFocus({ mainId, appName }: UseRouteFocusOptions): string | null {
  const router = useRouter();
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  // The pathname `processRoute` last actually handled — `undefined`
  // means "nothing processed yet" (the cold-load case). Deduping on the
  // *value*, not a one-shot boolean, matters because `onRendered` isn't
  // guaranteed to fire exactly once relative to this effect's own
  // subscribing: the initial route's own event can land either before
  // subscribing (missed, needs the manual `processRoute()` call below)
  // or after (caught twice for the same pathname) — a boolean flag would
  // treat that second, duplicate call as a "real" navigation and steal
  // focus onto a route that was actually the first paint.
  const lastProcessedPathnameRef = React.useRef<string | undefined>(undefined);
  const pathnameRef = React.useRef(router.state.location.pathname);
  const lastActionTypeRef = React.useRef<string | null>(null);
  const mainIdRef = React.useRef(mainId);
  const appNameRef = React.useRef(appName);
  mainIdRef.current = mainId;
  appNameRef.current = appName;

  // `router.history`/`router.subscribe` type as `any` here — `useRouter()`'s
  // generic defaults to `RegisteredRouter`, which only resolves to this
  // app's concrete router via a module augmentation declared in
  // `client-admin/src/main.tsx`, not visible from inside `ui`'s own
  // type-checking — cast to the real `RouterHistory` (`@tanstack/react-
  // router`) rather than let `no-unsafe-*` pass silently on `any`.
  const history = router.history as RouterHistory;

  // Capture phase, not `focusin`: Safari doesn't move focus to a clicked
  // `<a>` on its own, but every browser fires `click` before the
  // navigation it triggers commits — this has to run before that happens.
  React.useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-focus-anchor]',
      );
      const anchorId = target?.getAttribute('data-focus-anchor');
      if (anchorId) {
        focusAnchorMemory.set(pathnameRef.current, anchorId);
      }
    }
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  React.useEffect(() => {
    return history.subscribe(({ action }) => {
      lastActionTypeRef.current = action.type;
    });
  }, [history]);

  React.useEffect(() => {
    function processRoute() {
      const pathname = router.state.location.pathname;
      pathnameRef.current = pathname;

      const container = document.getElementById(mainIdRef.current) ?? document;
      const heading = container.querySelector<HTMLElement>('h1');

      document.title = heading?.textContent
        ? `${heading.textContent} · ${appNameRef.current}`
        : appNameRef.current;

      const isColdLoadOrDuplicate =
        lastProcessedPathnameRef.current === undefined ||
        pathname === lastProcessedPathnameRef.current;
      lastProcessedPathnameRef.current = pathname;
      if (isColdLoadOrDuplicate) {
        return;
      }

      setAnnouncement(heading?.textContent ?? null);

      const isReturning =
        lastActionTypeRef.current === 'BACK' || lastActionTypeRef.current === 'FORWARD';
      const anchorId = isReturning ? focusAnchorMemory.get(pathname) : undefined;
      const anchor = anchorId
        ? document.querySelector<HTMLElement>(`[data-focus-anchor="${cssEscape(anchorId)}"]`)
        : null;

      if (anchor) {
        anchor.focus();
        return;
      }

      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
        return;
      }

      if (container instanceof HTMLElement) {
        container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }

    // The current route's own `onRendered` already fired before this
    // effect subscribes (subscribing only happens post-mount) — this
    // covers that first route explicitly, `isFirstRunRef` skipping its
    // focus/announce step per the module doc above.
    processRoute();

    return router.subscribe('onRendered', processRoute);
  }, [router]);

  return announcement;
}
