/**
 * [8.9.7]'s focus-management/announcer/title logic, factored out of
 * `client-admin`'s `__root.tsx` so it stays package-agnostic (client-
 * student gets the same behaviour for free once it wires this in too).
 *
 * On every route change:
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
import { type RouterHistory, useRouter, useRouterState } from '@tanstack/react-router';
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
  // `resolvedLocation`, not `location`: the router updates `location`
  // (the URL) the moment a navigation starts, but `resolvedLocation`
  // only once matching finishes and the new route's component is what's
  // actually committed to the DOM — reacting to `location` here would
  // run this effect a tick early, while `Outlet` still renders the
  // *previous* route's `<h1>`, and (since the dependency wouldn't change
  // again) never correct itself.
  const pathname = useRouterState({
    select: (state) => state.resolvedLocation?.pathname ?? state.location.pathname,
  });
  const router = useRouter();
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  const isFirstRender = React.useRef(true);
  const pathnameRef = React.useRef(pathname);
  const lastActionTypeRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    // `router.history` types as `any` here — `useRouter()`'s generic
    // defaults to `RegisteredRouter`, which only resolves to this app's
    // concrete router via a module augmentation declared in
    // `client-admin/src/main.tsx`, not visible from inside `ui`'s own
    // type-checking — cast to the real `RouterHistory` (`@tanstack/
    // react-router`) rather than let `no-unsafe-*` pass silently on `any`.
    const history = router.history as RouterHistory;
    return history.subscribe(({ action }) => {
      lastActionTypeRef.current = action.type;
    });
  }, [router]);

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
    const container = document.getElementById(mainId) ?? document;
    const heading = container.querySelector<HTMLElement>('h1');

    document.title = heading?.textContent ? `${heading.textContent} · ${appName}` : appName;

    if (isFirstRender.current) {
      isFirstRender.current = false;
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
  }, [pathname, mainId, appName]);

  return announcement;
}
