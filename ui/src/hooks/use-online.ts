/**
 * [8.12.3] Connectivity as React state.
 *
 * `navigator.onLine` on its own is a one-shot read — a component that
 * consults it during render never learns the connection came back. This
 * subscribes to the `online`/`offline` window events that actually signal
 * the change, via `useSyncExternalStore` so React tears correctly under
 * concurrent rendering rather than through a `useState`/`useEffect` pair.
 *
 * Honest about what the browser knows: `navigator.onLine === false` means
 * "definitely no network". `true` only means the machine has *a* network
 * interface — a captive portal or a dead uplink still reads as online.
 * That asymmetry is why the offline fallback in `offline-cache.ts` keys
 * off an actual failed request, and this hook is only used for *labelling*
 * (`CachedDataNotice`) and for skipping pointless retries.
 */
import * as React from 'react';

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);
  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/** Server snapshot is `true`: a server render has no connectivity concept,
 * and optimistically rendering the *online* variant means the offline
 * banner appears on hydration rather than flashing away on it. */
function getServerSnapshot(): boolean {
  return true;
}

export function useOnline(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
