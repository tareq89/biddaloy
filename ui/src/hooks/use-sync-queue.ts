/**
 * [8.12.5] The offline mutation queue as React state.
 *
 * `api/mutation-queue.ts` already keeps a cached `QueueSnapshot` behind a
 * `subscribe`/`getSnapshot` pair built for exactly this — same shape as
 * `api/freshness.ts` and `api/auth-state.ts` — so this hook is a straight
 * `useSyncExternalStore` with no adapter in between.
 *
 * `getQueueSnapshot` doubles as the server snapshot: with no active tenant
 * it returns the stable `EMPTY_SNAPSHOT` *identity*, which is both safe to
 * call during a server render and safe to call repeatedly without tripping
 * React's "getSnapshot should be cached" loop detector.
 */
import * as React from 'react';

import { getQueueSnapshot, subscribeQueueChanges, type QueueSnapshot } from '../api/mutation-queue';

export function useSyncQueue(): QueueSnapshot {
  return React.useSyncExternalStore(subscribeQueueChanges, getQueueSnapshot, getQueueSnapshot);
}
