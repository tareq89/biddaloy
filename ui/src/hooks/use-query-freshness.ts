/**
 * [8.12.3] Reads `api/freshness.ts`'s side channel as React state, so a
 * component can render "showing saved data from 20 minutes ago" without
 * the query's own data type having to carry a timestamp. See that module's
 * header for why the age travels beside the data rather than inside it.
 */
import type { QueryKey } from '@tanstack/react-query';
import * as React from 'react';

import { getFreshness, subscribeFreshness, type QueryFreshness } from '../api/freshness';

/**
 * `undefined` until the query behind `queryKey` has resolved at least
 * once — an unresolved query has no age to report, which is different
 * from "it is fresh".
 */
export function useQueryFreshness(queryKey: QueryKey): QueryFreshness | undefined {
  // The key is read through a ref rather than closed over, so
  // `getSnapshot` keeps one stable identity for the life of the
  // component. Every caller builds its key from a factory
  // (`studentKeys.list(filters)`), which returns a fresh array on every
  // render — closing over that array directly would hand
  // `useSyncExternalStore` a new getter each render.
  //
  // Correctness does not depend on the ref: `getSnapshot` runs on every
  // render, and `getFreshness` looks up by `hashKey(queryKey)` (value,
  // not identity), so a changed key is read correctly on the very render
  // that changed it.
  const queryKeyRef = React.useRef(queryKey);
  queryKeyRef.current = queryKey;

  const getSnapshot = React.useCallback(() => getFreshness(queryKeyRef.current), []);
  return React.useSyncExternalStore(subscribeFreshness, getSnapshot, () => undefined);
}
