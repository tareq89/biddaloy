/**
 * jsdom implements neither the Pointer Events APIs Radix's Select/Dropdown-
 * Menu/Tooltip use for open/close and scroll-into-view behaviour, nor
 * `ResizeObserver` (Radix's popper positioning watches for size changes).
 * Without these, interacting with those components under jsdom throws
 * (`target.hasPointerCapture is not a function`) rather than testing
 * anything — this is a known jsdom/Radix gap, not a bug in either.
 * No-op stubs are enough: these tests assert on rendered output and
 * `document.activeElement`, never on real pointer-capture or resize
 * behaviour, which needs a real browser (see `ui/README.md`'s testing
 * section) to mean anything anyway.
 *
 * Guarded on `typeof Element` because `ui/vitest.config.ts` applies this
 * same setup file to both the `:node` project (no DOM at all — `Element`
 * doesn't exist) and `:jsdom` project; unconditionally touching
 * `Element.prototype` would throw in the node project.
 */
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/** jsdom (as of v30) does not implement `window.matchMedia` at all — not
 * even a stub that reports `matches: false` — so any code that calls it
 * unconditionally throws under `:jsdom` tests. `ui/src/theme/
 * theme-provider.tsx` guards every call with `typeof matchMedia ===
 * 'function'`, so this stub is not required for that module to load, but
 * without it there would be no way for a test to simulate
 * `prefers-color-scheme: dark` or a live OS preference change at all — the
 * guard would just always take the "not supported" branch.
 *
 * A real `EventTarget` subclass, not a plain object with no-op listener
 * methods, and cached one-per-query rather than a fresh object per call:
 * `theme-provider.tsx` registers its `change` listener once, at module
 * load, against whatever object *that* one call to `matchMedia(query)`
 * returned. A test simulating an OS preference flip
 * (`ui/src/test/system-theme.ts`'s `mockSystemPrefersDark`) has to mutate
 * and dispatch on that exact same object for the listener to fire — a
 * fresh object per call, or per-instance no-op `addEventListener`, would
 * make that impossible. `matches: false` by default matches a light-OS
 * visitor. */
class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  matches = false;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;
  constructor(readonly media: string) {
    super();
  }
  addListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => unknown): void {
    this.addEventListener('change', listener as EventListener);
  }
  removeListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => unknown): void {
    this.removeEventListener('change', listener as EventListener);
  }
}

const mediaQueryLists = new Map<string, FakeMediaQueryList>();

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => {
    let mql = mediaQueryLists.get(query);
    if (!mql) {
      mql = new FakeMediaQueryList(query);
      mediaQueryLists.set(query, mql);
    }
    return mql;
  };
}
