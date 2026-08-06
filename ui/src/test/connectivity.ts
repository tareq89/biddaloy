/**
 * Mocks `navigator.onLine` for `useOnline`-style hooks. jsdom's
 * `navigator.onLine` is a real getter with no setter — `navigator.onLine =
 * false` silently no-ops rather than throwing, which reads as "it worked"
 * right up until the hook under test never sees the change. This replaces
 * the property with a configurable one via `Object.defineProperty`, and
 * dispatches the matching `online`/`offline` window event, since that's
 * what a real hook listens for to react to the change, not polling the
 * property itself.
 *
 * This module is imported from `ui/src/test/setup.ts`, which runs for
 * every project — including the `:node` ones, where there is no `window`.
 * Every export here is a guarded no-op there, since `mockOnlineStatus`
 * only makes sense in a project with a DOM anyway.
 */
const hasWindow = typeof window !== 'undefined';

const ORIGINAL_ON_LINE_DESCRIPTOR = hasWindow
  ? Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
  : undefined;

export function mockOnlineStatus(online: boolean): void {
  if (!hasWindow) return;
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

/** Restores `navigator.onLine` to jsdom's real implementation. Wired into
 * `ui/src/test/setup.ts`'s `afterEach` — call directly only if a test
 * needs the real value back before it ends, not after. */
export function resetOnlineStatus(): void {
  if (!hasWindow || !ORIGINAL_ON_LINE_DESCRIPTOR) return;
  Object.defineProperty(window.navigator, 'onLine', ORIGINAL_ON_LINE_DESCRIPTOR);
}
