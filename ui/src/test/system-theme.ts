/**
 * Simulates `prefers-color-scheme: dark` for `ui/src/theme/
 * theme-provider.tsx`'s live OS-preference sync. jsdom does not implement
 * `matchMedia` at all — `jsdom-polyfills.ts`'s `FakeMediaQueryList` stub
 * does, as a real `EventTarget` cached one-per-query so a test and the
 * module under test share the exact same object. This drives that stub's
 * `matches` property and fires the `change` event a real browser would, so
 * `theme-provider.tsx`'s listener (registered once, at module load) reacts
 * exactly as it would to a real OS-level flip.
 *
 * Guarded no-op under the `:node` project, same reasoning as
 * `connectivity.ts`'s `mockOnlineStatus`: there is no `window` there for
 * this to mean anything.
 */
const hasWindow = typeof window !== 'undefined';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function mockSystemPrefersDark(prefersDark: boolean): void {
  if (!hasWindow) return;
  const mql = window.matchMedia(DARK_MEDIA_QUERY);
  if (mql.matches === prefersDark) return;
  // `matches` is a real own property on `FakeMediaQueryList`, not an
  // accessor — a direct assignment is enough, no `Object.defineProperty`
  // needed (unlike `connectivity.ts`'s `navigator.onLine`, which jsdom
  // exposes as a getter with no setter).
  (mql as { matches: boolean }).matches = prefersDark;
  mql.dispatchEvent(Object.assign(new Event('change'), { matches: prefersDark, media: mql.media }));
}

/** Wired into `ui/src/test/setup.ts`'s `afterEach` — restores the default
 * "light OS" state so one test's simulated dark preference cannot leak
 * into the next test in the same file. */
export function resetSystemPrefersDark(): void {
  mockSystemPrefersDark(false);
}
