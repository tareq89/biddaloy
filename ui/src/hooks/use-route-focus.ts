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
 * Every `MutationObserver` callback (most of which have nothing to do
 * with a route change — a query refetching, a toast appearing) does two
 * *independently* deduped things:
 * - `document.title` is set from the new route's own `<h1>` — searched
 *   inside the `mainId` landmark first, falling back to the whole
 *   `document` for the two chrome-free routes ([8.9.4]'s `/login`,
 *   [8.9.5]'s `/select-school`) that render outside `AppShell` and so
 *   have no `mainId` element at all, but do carry their own top-level
 *   `<h1>` (`SignInForm`/`SchoolPicker`'s own heading). Deduped against
 *   the last *heading text* seen, so this also catches a same-route
 *   content update (a detail page's `<h1>` resolving from a loading
 *   placeholder to the loaded entity's name).
 * - Focus moves to that `<h1>` (or, if none exists, to the `mainId`
 *   landmark itself), and the same text is handed back for a
 *   `RouteAnnouncer` to announce — but only on an actual *route* change,
 *   deduped against the last **pathname** seen, not heading text: two
 *   different routes that happen to render the same `<h1>` text are
 *   still a real navigation, and a same-route heading update (the case
 *   above) is deliberately *not* one, since yanking focus back to the
 *   heading every time a background query resolves would be its own
 *   surprise. Skipped entirely on the very first observed heading (cold
 *   load), too — grabbing focus there wasn't a "route change" either,
 *   and would be surprising to a keyboard/AT visitor who didn't trigger
 *   a navigation.
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
import { flushSync } from 'react-dom';

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
  // The `<h1>` text last actually processed — used only to avoid a
  // redundant `document.title` write on a `MutationObserver` callback
  // that fired for something other than a heading change.
  const lastHeadingTextRef = React.useRef<string | null | undefined>(undefined);
  // The pathname last actually processed — `undefined` means "nothing
  // seen yet" (the cold-load case). This, not `lastHeadingTextRef`, is
  // what decides whether focus should move: two *different* routes that
  // happen to render the same `<h1>` text are still a real navigation —
  // deduping on heading text alone would silently skip the focus/
  // announce step for exactly that case. Pathname only, not the full
  // location (with search params): a same-route search-param change
  // (`/students?page=1` → `?page=2`) is in-page state, not a page
  // change, and stealing focus back to the heading on every "Next page"
  // click would be its own regression.
  const lastPathnameRef = React.useRef<string | undefined>(undefined);
  const lastActionTypeRef = React.useRef<string | null>(null);
  // The previous route's `<h1>` DOM node, plus a flag for a route change
  // seen while that node was still the one in the document — see the
  // deferral comment in `processHeading`.
  const lastHeadingElRef = React.useRef<HTMLElement | null>(null);
  const pendingRouteChangeRef = React.useRef(false);
  // The node this hook last moved focus to — so a same-route re-render
  // that replaces it (skeleton → loaded content re-creating the `<h1>`)
  // can be detected and focus re-anchored instead of silently falling
  // back to `<body>`.
  const focusedHeadingRef = React.useRef<HTMLElement | null>(null);

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
      const pathname = router.state.location.pathname;
      const container = document.getElementById(mainId) ?? document;
      const heading = container.querySelector<HTMLElement>('h1');
      const headingText = heading?.textContent ?? null;

      // Keeps `document.title` in sync with whatever's actually
      // rendered, independent of the route-change check below — a
      // same-route content update (a detail page's `<h1>` going from a
      // loading placeholder to the loaded entity's name, say) should
      // still retitle the tab even though it isn't a page change.
      if (headingText !== lastHeadingTextRef.current) {
        lastHeadingTextRef.current = headingText;
        document.title = headingText ? `${headingText} · ${appName}` : appName;
      }

      const isRouteChange = pathname !== lastPathnameRef.current;
      const isColdLoad = lastPathnameRef.current === undefined;
      lastPathnameRef.current = pathname;

      if (isColdLoad) {
        lastHeadingElRef.current = heading;
        return;
      }

      // The router can commit the new pathname before the new page's DOM
      // lands — the first mutation after a click is often the nav link's
      // own class change, at which point `heading` is still the *old*
      // page's `<h1>`. Announcing/focusing it would announce the page
      // being left and then lose focus to `<body>` when that node
      // unmounts. Defer: remember a route change is pending and process
      // it on the mutation that delivers a different heading node.
      const wasPending = pendingRouteChangeRef.current;
      if (
        (isRouteChange || wasPending) &&
        heading !== null &&
        heading === lastHeadingElRef.current
      ) {
        pendingRouteChangeRef.current = true;
        return;
      }

      const isPending = wasPending;
      pendingRouteChangeRef.current = false;
      lastHeadingElRef.current = heading;

      if (!isRouteChange && !isPending) {
        // A same-route re-render can replace the very node the
        // route-change focus landed on, dropping focus to `<body>`.
        // Only re-anchor when *this hook's* target vanished and nothing
        // else took focus — a user who tabbed elsewhere is left alone.
        if (
          heading !== null &&
          focusedHeadingRef.current !== null &&
          heading !== focusedHeadingRef.current &&
          !document.contains(focusedHeadingRef.current) &&
          document.activeElement === document.body
        ) {
          heading.setAttribute('tabindex', '-1');
          heading.focus();
          focusedHeadingRef.current = heading;
        }
        return;
      }

      // Clear then re-set, not a single `setAnnouncement(headingText)` —
      // two different routes can share the same heading text (e.g. two
      // list pages both titled "Students"), and React bails out of a
      // state update whose value is unchanged from the last one, so the
      // live region's `textContent` would never actually mutate and a
      // screen reader would never announce the navigation. `flushSync`
      // forces the clear to commit as its own DOM mutation before the
      // real text is set, so there's always a change to announce.
      flushSync(() => setAnnouncement(null));
      setAnnouncement(headingText);

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
        focusedHeadingRef.current = heading;
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
