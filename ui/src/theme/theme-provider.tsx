/**
 * Theme resolution and live sync — the runtime counterpart to
 * `client-admin/index.html`'s inline boot script. The boot script only
 * covers the window before any JS module has loaded (first paint); this
 * module takes over the moment it does, and is the only place that ever
 * writes `document.documentElement.dataset.theme` after boot.
 *
 * Deliberately holds no cached `Theme` value of its own — `getSnapshot()`
 * below recomputes from `getPersistedTheme()` + `prefers-color-scheme` on
 * every call rather than caching the result in a module variable. Two
 * things fall out of that:
 *
 *  - The "no explicit choice stored -> follow `prefers-color-scheme` live"
 *    requirement (design contract, [8.13.12]'s acceptance criteria) keeps
 *    working for as long as the tab is open, independent of whether any
 *    component that calls `useTheme()` happens to be mounted at the moment
 *    the OS preference flips — the `matchMedia` listener below applies the
 *    DOM change directly and merely notifies subscribers, it does not need
 *    to update a cache for them to see it.
 *  - There is no module-level state for a test to leak across test files —
 *    `localStorage` (reset by `cleanupTestState()`, see
 *    `theme-storage.ts`) and the DOM attribute are the only things that can
 *    ever go stale, and both are ordinary, resettable state rather than a
 *    third copy this module would otherwise have to keep in sync too.
 *
 * `useTheme()` is a thin `useSyncExternalStore` wrapper so React components
 * re-render when the resolved theme changes, whichever of the toggle or the
 * OS caused it.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { getPersistedTheme, persistTheme, resolveTheme, type Theme } from './theme-storage';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

// `#4a3fd4` / `#1e293b` mirror `tailwind.preset.ts`'s `light.brand` and
// `dark.surface` literals — see that file's own values. Duplicated here
// rather than imported: no `ui/src` runtime module imports the preset file
// today (components consume tokens through Tailwind utility classes, not
// JS values), and this is the one runtime spot that has to reach for a
// literal because a `<meta>` tag's `content` attribute cannot read a CSS
// custom property. `client-admin/index.html`'s boot script duplicates the
// same two values for the same reason — keep all three in sync by hand.
const THEME_COLOR: Record<Theme, string> = {
  light: '#4a3fd4',
  dark: '#1e293b',
};

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_MEDIA_QUERY).matches;
}

/** The one source of truth for "what theme should be active right now" —
 * `ui:node`'s lack of a DOM (no `localStorage`, no `matchMedia`) resolves
 * to `'light'` via `theme-storage.ts`'s own no-storage fallback and the
 * `typeof matchMedia` guard below, same as a real light-OS visitor. */
function computeTheme(): Theme {
  return resolveTheme(getPersistedTheme(), systemPrefersDark());
}

/** Reflects a theme onto the DOM: the `data-theme` attribute every `dark:`
 * utility and token override keys off (globals.css's `@custom-variant
 * dark`), and the `<meta name="theme-color">` tag that tints the mobile
 * status bar / desktop title bar in standalone PWA mode. Light mode removes
 * the attribute entirely rather than setting `data-theme="light"` — the
 * light tokens are already the `:root` default, so an absent attribute and
 * an explicit `"light"` would be redundant, and an absent one is what the
 * boot script already produces for a light first paint. No-ops under
 * `ui:node` (`typeof document === 'undefined'`). */
function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return computeTheme();
}

// Applied once at module load, mirroring the boot script's own read, so any
// environment that never calls `useTheme()` at all (nothing does yet
// outside `ThemeToggle`) — a story, a route without the toggle in its tree —
// still ends up with a DOM that matches what `getPersistedTheme()`/
// `prefers-color-scheme` says, not just whatever the boot script produced
// before this bundle arrived.
applyTheme(computeTheme());

/** Sets an explicit choice: persists it, applies it, and notifies every
 * subscribed `useTheme()` call. An explicit choice always wins over the OS
 * preference from this point on — the live `matchMedia` listener below
 * checks `getPersistedTheme()` before ever acting, so it steps aside the
 * moment this has been called once.
 *
 * Applies `computeTheme()` — the recomputed result — rather than the raw
 * `theme` argument. `persistTheme()` silently swallows a storage failure
 * (quota exceeded, disabled storage); if the write is lost, `computeTheme()`
 * falls back to the OS preference, same as any other read. Applying that
 * recomputed value, instead of the value storage never actually recorded,
 * is what keeps the DOM and every future `getSnapshot()` call in agreement
 * — this module's "no cache" invariant (see the file header) means there is
 * no other source of truth for either of them to fall back on. */
function setExplicitTheme(theme: Theme): void {
  persistTheme(theme);
  applyTheme(computeTheme());
  notify();
}

function toggleTheme(): void {
  setExplicitTheme(computeTheme() === 'dark' ? 'light' : 'dark');
}

// Runtime sync (acceptance criterion: "respects prefers-color-scheme ...
// explicit user choice always winning"). Fires on every OS-level flip
// (a scheduled dark-mode switch, a manual OS settings change) for as long
// as this tab is open. `typeof matchMedia === 'function'` guards both the
// `ui:node` Vitest project and jsdom, which — as of jsdom 30 — does not
// implement `matchMedia` at all unless a test stubs it in
// (`ui/src/test/jsdom-polyfills.ts`).
if (typeof matchMedia === 'function') {
  matchMedia(DARK_MEDIA_QUERY).addEventListener('change', (event) => {
    if (getPersistedTheme() !== null) return; // an explicit choice already wins
    applyTheme(event.matches ? 'dark' : 'light');
    notify();
  });
}

export interface UseThemeResult {
  theme: Theme;
  /** Sets an explicit choice. Persists across reloads; from this point the
   * OS preference no longer has a vote until `clearPersistedTheme()` is
   * called (there is no UI for that today — clearing is a test-only
   * escape hatch, see `theme-storage.ts`). */
  setTheme: (theme: Theme) => void;
  /** Flips the current resolved theme and treats the result as an explicit
   * choice — what `ThemeToggle` calls on click. */
  toggleTheme: () => void;
}

/** Subscribes to the shared theme store. Safe to call from more than one
 * component at once — every subscriber re-renders together, the same
 * guarantee `useSyncExternalStore` gives any other external store in this
 * codebase (compare `auth-state.ts`'s consumers). */
export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(subscribe, getSnapshot);
  return {
    theme,
    setTheme: useCallback((next: Theme) => setExplicitTheme(next), []),
    toggleTheme: useCallback(() => toggleTheme(), []),
  };
}
