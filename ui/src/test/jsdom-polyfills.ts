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
