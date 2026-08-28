/**
 * [8.12.3] The side channel that tells the UI how old the data it is
 * rendering actually is.
 *
 * The obvious design — wrap every query's data in `{ data, fetchedAt }` —
 * was rejected: every route loader (`ensureQueryData`), every table, every
 * `.map()` over a list would have to be rewritten, and a single missed
 * call site becomes a runtime crash. So query data types stay *byte
 * identical*, and the age travels alongside them in this module-level map,
 * keyed by the same `hashKey(queryKey)` TanStack Query uses internally.
 *
 * The subscribe/notify shape is deliberately the same one as
 * `auth-state.ts` — a plain `Set` of listeners plus a bump — so
 * `useQueryFreshness` can be a straight `useSyncExternalStore`.
 *
 * Cleared from the same two funnels as the caches themselves
 * (`setActiveTenant` on a real switch, `clearAuthState`): a stale
 * "loaded 3 minutes ago" label under a *different* tenant's data would be
 * an outright lie about which school the figure came from.
 */
import { hashKey, type QueryKey } from '@tanstack/react-query';

export type FreshnessSource =
  /** Straight from the server on this request. */
  | 'network'
  /** A 200 the service worker's `NetworkFirst` cache replayed. Looks like
   * a normal success to axios — the `Date` header is what gives it away. */
  | 'sw-cache'
  /** Read back out of the Dexie store after a network failure. */
  | 'dexie';

export interface QueryFreshness {
  /** Epoch ms the server produced the response. */
  fetchedAt: number;
  source: FreshnessSource;
}

const freshnessByQueryHash = new Map<string, QueryFreshness>();

const listeners = new Set<() => void>();

function notifyFreshnessChange(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeFreshness(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordFreshness(queryKey: QueryKey, freshness: QueryFreshness): void {
  const hash = hashKey(queryKey);
  const previous = freshnessByQueryHash.get(hash);
  // Re-notifying on an identical entry would re-render every
  // `useQueryFreshness` consumer on each background refetch that came
  // back with the same server `Date` — the common case on a fast poll.
  if (
    previous &&
    previous.fetchedAt === freshness.fetchedAt &&
    previous.source === freshness.source
  ) {
    return;
  }
  freshnessByQueryHash.set(hash, freshness);
  notifyFreshnessChange();
}

export function getFreshness(queryKey: QueryKey): QueryFreshness | undefined {
  return freshnessByQueryHash.get(hashKey(queryKey));
}

/** Wired into the two purge funnels in `auth-state.ts`. */
export function clearFreshness(): void {
  if (freshnessByQueryHash.size === 0) return;
  freshnessByQueryHash.clear();
  notifyFreshnessChange();
}
