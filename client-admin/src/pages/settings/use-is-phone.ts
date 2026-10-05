import * as React from 'react';

/** Tailwind `md` is 768px; below it the settings cards switch to their phone layout. */
const PHONE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const list = matchMedia(PHONE_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;
}

/**
 * True on a phone-width viewport. Used where the desktop and phone layouts
 * differ in markup (a table vs. blocks): mounting only one keeps the same
 * accessible names from appearing twice. jsdom has no `matchMedia`, so
 * tests get the desktop layout unless they stub it.
 */
export function useIsPhone(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
