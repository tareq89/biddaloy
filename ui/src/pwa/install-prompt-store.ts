/**
 * [15.8.2] Module-level capture of the `beforeinstallprompt` event.
 *
 * Chrome fires `beforeinstallprompt` at most once per page load, and only
 * if nothing has already prevented its default — so it must be listened
 * for before React ever mounts, not from inside a component's `useEffect`
 * (which could easily run after the browser already fired and discarded
 * it). `listen()` is called once from `client-admin/src/main.tsx`, at the
 * very top, before `renderApp()`. This module then holds the captured
 * event as plain module state and exposes a `useSyncExternalStore`-shaped
 * subscribe/getSnapshot pair so `use-install-prompt.ts` can read it and
 * re-render on changes — same pattern as `hooks/use-online.ts`.
 *
 * Also tracks `display-mode: standalone` (already installed / running as
 * an app) via `matchMedia`, and clears the captured event on
 * `appinstalled` — once installed, there is nothing left to prompt.
 */

/** Chrome's `BeforeInstallPromptEvent` isn't in lib.dom yet. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface InstallPromptSnapshot {
  /** The captured event, or `null` if none has fired yet (or it was
   * already consumed by `install()`, or the app installed). */
  event: BeforeInstallPromptEvent | null;
  /** Whether the app is currently running in standalone (installed) mode. */
  standalone: boolean;
}

let snapshot: InstallPromptSnapshot = { event: null, standalone: false };
let listening = false;
let teardown: AbortController | null = null;
const listeners = new Set<() => void>();

function setSnapshot(next: InstallPromptSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Registers the `beforeinstallprompt`/`appinstalled`/standalone-media
 * listeners. Idempotent — safe to call more than once (e.g. under React
 * StrictMode's double-invoke or a hot reload), only the first call does
 * anything. Must run before React mounts; see this file's header comment.
 */
export function listen(): void {
  if (listening) return;
  // `typeof window === 'undefined'` (SSR, or a node-tier test importing
  // this module) must NOT latch `listening` — the real, browser-side
  // `listen()` call from `main.tsx` still needs to run and attach its
  // listeners once a `window` actually exists.
  if (typeof window === 'undefined') return;
  listening = true;
  teardown = new window.AbortController();
  const { signal } = teardown;

  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  setSnapshot({ event: snapshot.event, standalone: standaloneQuery.matches });

  window.addEventListener(
    'beforeinstallprompt',
    (event) => {
      // Chrome's default is to show its own mini-infobar — prevented so this
      // app controls if/when an install affordance appears instead.
      event.preventDefault();
      setSnapshot({ event: event as BeforeInstallPromptEvent, standalone: snapshot.standalone });
    },
    { signal },
  );

  window.addEventListener(
    'appinstalled',
    () => {
      setSnapshot({ event: null, standalone: snapshot.standalone });
    },
    { signal },
  );

  const onStandaloneChange = (event: MediaQueryListEvent): void => {
    setSnapshot({ event: snapshot.event, standalone: event.matches });
  };
  if (standaloneQuery.addEventListener) {
    standaloneQuery.addEventListener('change', onStandaloneChange, { signal });
  }
}

/** Consumes the captured event — called by `install()` in
 * `use-install-prompt.ts`. Clears it regardless of the prompt's outcome,
 * since `beforeinstallprompt` is one-shot: a second install attempt needs
 * a fresh event. */
export function consumeEvent(): BeforeInstallPromptEvent | null {
  const event = snapshot.event;
  if (event) setSnapshot({ event: null, standalone: snapshot.standalone });
  return event;
}

export function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getSnapshot(): InstallPromptSnapshot {
  return snapshot;
}

/** Test-only: resets module state between test files/cases. */
export function resetForTests(): void {
  teardown?.abort();
  teardown = null;
  snapshot = { event: null, standalone: false };
  listening = false;
  listeners.clear();
}
