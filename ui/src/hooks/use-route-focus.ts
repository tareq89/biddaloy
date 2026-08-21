/**
 * [8.9.7]'s focus-management/announcer/title logic, factored out of
 * `client-admin`'s `__root.tsx` so it stays package-agnostic (client-
 * student gets the same behaviour for free once it wires this in too).
 *
 * Triggered by a `MutationObserver` on the actually-rendered DOM, not by
 * subscribing to router state or router lifecycle events. Two different
 * router-driven approaches were tried and both broke under real browser
 * timing (caught by `e2e/focus-management.spec.ts`, not the unit tests,
 * which use a synthetic loader-less route tree that doesn't reproduce
 * either problem):
 * - A `useEffect` on `useRouterState`'s `location`/`resolvedLocation` can
 *   fire a tick before TanStack Router's `React.startTransition`-wrapped
 *   commit actually lands, reading the *previous* route's stale `<h1>` —
 *   and since the watched value won't change again for that navigation,
 *   it never self-corrects.
 * - `router.subscribe('onRendered', ...)` (the mechanism this package's
 *   own `scroll-restoration.js` uses for the equivalent scroll-position
 *   problem) turned out not to fire reliably for every client-side
 *   navigation under Vite's dev server specifically — `@tanstack/router-
 *   core`'s `load-client.js` takes a separate `transitionRefresh` code
 *   path outside production, which can return without ever emitting
 *   `onResolved`/`onRendered`.
 *
 * A `MutationObserver` sidesteps both: it can only fire *after* the DOM
 * has actually changed, so there is no "too early" reading of stale
 * content, and it doesn't depend on any router internal staying stable
 * across versions or build modes — it's watching the actual rendered
 * page, which is the one thing guaranteed to reflect the real route.
 *
 * On every observed `<h1>`-text change (deduped against the last text
 * seen, since most DOM mutations under `document.body` have nothing to
 * do with a route change):
 * - `document.title` is set from the new route's own `<h1>` — searched
 *   inside the `mainId` landmark first, falling back to the whole
 *   `document` for the two chrome-free routes ([8.9.4]'s `/login`,
 *   [8.9.5]'s `/select-school`) that render outside `AppShell` and so
 *   have no `mainId` element at all, but do carry their own top-level
 *   `<h1>` (`SignInForm`/`SchoolPicker`'s own heading).
 * - Focus moves to that `<h1>` (or, if none exists, to the `mainId`
 *   landmark itself) — except on the very first observed heading, where
 *   the browser's own default focus (address bar) is left alone;
 *   grabbing focus on cold load isn't a "route change" and would be
 *   surprising to a keyboard/AT visitor who didn't trigger a navigation.
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
  // The `<h1>` text last actually processed — `undefined` means "nothing
  // seen yet" (the cold-load case). Compared by value, not a one-shot
  // boolean flag, so a `MutationObserver` callback firing more than once
  // for what's genuinely the same heading (e.g. an unrelated re-render
  // touching the DOM) is a no-op rather than a spurious focus steal.
  const lastHeadingTextRef = React.useRef<string | null | undefined>(undefined);
  const lastActionTypeRef = React.useRef<string | null>(null);

  // `router.history` types as `any` here — `useRouter()`'s generic
  // defaults to `RegisteredRouter`, which only resolves to this app's
  // concrete router via a module augmentation declared in `client-admin/
  // src/main.tsx`, not visible from inside `ui`'s own type-checking —
  // cast to the real `RouterHistory` (`@tanstack/react-router`) rather
  // than let `no-unsafe-*` pass silently on `any`.
  const history = router.history as RouterHistory;

  React.useEffect(() => {
    return history.subscribe(({ action }) => {
      lastActionTypeRef.current = action.type;
    });
  }, [history]);

  // Capture phase, not `focusin`: Safari doesn't move focus to a clicked
  // `<a>` on its own, but every browser fires `click` before the
  // navigation it triggers commits — this has to run before that happens.
  // Reads `router.state.location.pathname` live (the pathname being
  // *left*, at the moment of the click) rather than a cached ref, since
  // that value is accurate immediately and doesn't depend on when this
  // navigation's DOM update actually lands.
  React.useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-focus-anchor]',
      );
      const anchorId = target?.getAttribute('data-focus-anchor');
      if (anchorId) {
        focusAnchorMemory.set(router.state.location.pathname, anchorId);
      }
    }
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [router]);

  React.useEffect(() => {
    function processHeading() {
      const container = document.getElementById(mainId) ?? document;
      const heading = container.querySelector<HTMLElement>('h1');
      const headingText = heading?.textContent ?? null;

      if (headingText === lastHeadingTextRef.current) return;
      const isColdLoad = lastHeadingTextRef.current === undefined;
      lastHeadingTextRef.current = headingText;

      document.title = headingText ? `${headingText} · ${appName}` : appName;

      if (isColdLoad) return;

      setAnnouncement(headingText);

      const pathname = router.state.location.pathname;
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

    // The initial route's own heading, already in the DOM by the time
    // this effect runs (React only runs effects post-commit) — handled
    // explicitly since a `MutationObserver` only reports mutations that
    // happen *after* `observe()` is called below, not this one.
    processHeading();

    const observer = new MutationObserver(processHeading);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [router, mainId, appName]);

  return announcement;
}
