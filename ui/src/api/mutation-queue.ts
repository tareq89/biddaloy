/**
 * [8.12.4] Tier 3 offline strategy: a durable, tenant-scoped **mutation
 * queue**. A write made while the connection is down is persisted to
 * IndexedDB and replayed, in submission order, once the browser is back
 * online — so a teacher marking attendance on a school corridor's dead
 * spot does not lose the period's work when the tab is closed.
 *
 * ## What this issue ships, and what it does not
 *
 * This module is the engine, fully tested, with **no product mutation
 * wired into it yet**. The anticipated first consumer is client-teacher
 * attendance, and neither exists: `server/openapi.json` has no
 * attendance endpoints, and there is no `client-teacher` app. So no
 * mutation hook in `ui/src/hooks/*` calls `enqueueMutation`, and the
 * replay tests drive `apiClient` through a mock. Reading the issue title
 * as "attendance works offline now" is wrong — that switches on when the
 * consumer arrives (see #184/#185).
 *
 * ## The one rule that is not a preference
 *
 * **Money is never queued.** Payments, fee generation, invoice creation
 * and enrolment changes must not go through here, and the rule is
 * enforced twice, on purpose:
 *
 * 1. *Compile time* — `entity` is a closed `QueueableEntity` union
 *    (`offline-db.ts`), so `entity: 'payments'` does not typecheck.
 * 2. *Runtime* — `path` is a plain string that can be built at runtime,
 *    so `FORBIDDEN_QUEUE_PATH` below rejects money-shaped paths before
 *    anything touches Dexie.
 *
 * Either check alone is defeatable; both together mean a queued payment
 * takes a deliberate edit to two guards with comments telling you not to.
 *
 * ## Ordering, and why a bad row stops everything
 *
 * ```text
 *  seq 1 ─▶ POST /attendance  ─▶ 204 ─▶ row deleted
 *  seq 2 ─▶ PATCH /attendance ─▶ 409 ─▶ row marked `conflict`  ──┐
 *  seq 3 ─▶ ...                                     never sent ◀─┘
 * ```
 *
 * Replay is strictly sequential and halts at the first `conflict` or
 * `dead` row. Later rows commonly touch the same record as the blocked
 * one (correcting an attendance mark you just made), so letting them
 * jump the queue applies edits out of order against a server state
 * nobody has reconciled. Throughput loses to correctness. If #184's UX
 * wants skip-and-continue, that is a policy change in `runReplay`, not
 * a constraint of the store.
 *
 * ## Tenant scoping and purge
 *
 * Every read and write filters on the *active* tenant, so a row queued
 * under school A is never sent or even counted under school B. Unlike
 * the read cache (#182), a tenant switch does **not** purge the queue:
 * a cached read is reproducible, a queued mutation is the user's
 * unsaved work. It resumes when they switch back. Logout is different
 * and destroys everything, through the existing `deleteOfflineDb()`
 * funnel in `clearAuthState()`.
 */
import axios from 'axios';

import { currentSessionGeneration, getActiveTenant, subscribeAuthState } from './auth-state';
import { apiClient } from './client';
import { ApiError } from './errors';
import { isNoResponseNetworkError } from './offline-cache';
import {
  getOfflineDb,
  type QueuedMutationMethod,
  type QueuedMutationRow,
  type QueueableEntity,
} from './offline-db';

/**
 * Money-shaped paths, anchored to whole path segments.
 *
 * The anchoring matters: `/fees/dues` (a read) must not match, or a
 * later, legitimate `fees` sub-path gets rejected for the wrong reason
 * and someone "fixes" the guard by loosening it. Only `/fees/generate`
 * — the endpoint that mints charges — is forbidden under `fees`.
 *
 * Matches the real server surface: `/api/v1/payments*`,
 * `/api/v1/fees/generate`, `/api/v1/invoices*`, `/api/v1/enrollments*`
 * (`apiClient` supplies the `/api/v1` prefix, so paths arrive here as
 * `/payments/...`).
 */
const FORBIDDEN_QUEUE_PATH = /\/(payments|invoices|enrollments|fees\/generate)(\/|\?|$)/i;

/**
 * Normalises a path before the guard sees it, because the guard's whole
 * job is catching strings built at runtime — and those arrive in shapes a
 * naive regex misses:
 *
 *   - `'payments/123'` with no leading slash. Axios still resolves it
 *     against the base URL to `/api/v1/payments/123`, so it reaches the
 *     real controller.
 *   - `'/PAYMENTS/123'`. Express (Nest's default adapter) routes
 *     case-insensitively, so this reaches the controller too — hence the
 *     `i` flag above.
 *
 * Both spellings enqueued successfully before this existed, which made
 * the runtime half of the money guard decorative.
 */
function normalisePathForGuard(path: string): string {
  return `/${path.replace(/^\/+/, '')}`;
}

/** Thrown by `enqueueMutation` before anything is persisted. Named, not a
 * bare `Error`, so a consumer can tell "you may not queue this" apart
 * from "the queue is broken" — the first is a programming error to fix,
 * the second is something to show the user. */
export class ForbiddenQueueMutationError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `Refusing to queue a mutation against "${path}" — payments, fee generation, ` +
        'invoices and enrolment changes must never be replayed later.',
    );
    this.name = 'ForbiddenQueueMutationError';
    this.path = path;
  }
}

/** Thrown when the queue cannot persist the mutation. Silently dropping
 * the user's work is the one failure mode this module refuses: the
 * caller must be able to tell them the write did not stick. */
export class QueueUnavailableError extends Error {
  constructor(reason: string) {
    super(`Cannot queue this mutation offline: ${reason}`);
    this.name = 'QueueUnavailableError';
  }
}

/** Server-answered failures tolerated before a row is dead-lettered.
 * Finite by design — an item that fails forever must stop consuming
 * retries rather than spin against the server for the life of the tab. */
export const MAX_REPLAY_ATTEMPTS = 5;

/** Ceiling on the exponential backoff, so a long-lived tab does not end
 * up retrying once an hour. */
const MAX_REPLAY_BACKOFF_MS = 60_000;

export interface EnqueueMutationInput {
  entity: QueueableEntity;
  method: QueuedMutationMethod;
  /** `apiClient`-relative, e.g. `/attendance`. */
  path: string;
  body?: unknown;
}

/** What #184's indicator renders. Counts are for the **active tenant
 * only**. */
export interface QueueSnapshot {
  tenantId: string | null;
  total: number;
  pending: number;
  conflict: number;
  dead: number;
  /** Ascending `seq` — replay order, which is also the order a list UI
   * should show. */
  rows: readonly QueuedMutationRow[];
  /** The queue could not be read. Distinct from `total: 0`, and the
   * distinction matters: "you have no unsynced changes" and "I cannot
   * tell you whether you have unsynced changes" must not look the same
   * to someone deciding whether it is safe to close the tab. */
  readFailed: boolean;
}

const EMPTY_SNAPSHOT: QueueSnapshot = {
  tenantId: null,
  total: 0,
  pending: 0,
  conflict: 0,
  dead: 0,
  rows: [],
  readFailed: false,
};

/** Same subscribe/notify shape as `freshness.ts` and `auth-state.ts` — a
 * plain `Set` plus a cached snapshot object — so #184's `useSyncQueue`
 * is a straight `useSyncExternalStore` with no adapter in between. */
const listeners = new Set<() => void>();

let snapshot: QueueSnapshot = EMPTY_SNAPSHOT;

function notifyQueueChange(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeQueueChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Synchronous by contract — `useSyncExternalStore` requires it, and
 * Dexie is async, so the snapshot is a cache refreshed after every
 * change.
 *
 * When the active tenant has moved on from the cached snapshot (a
 * switch, or the very first call), it returns the stable `EMPTY_SNAPSHOT`
 * *identity* and kicks off a refresh which notifies when it lands. That
 * ordering is deliberate: showing "0 queued" for a frame is honest under
 * a tenant whose rows have not been read yet, whereas showing the
 * previous tenant's counts is not.
 */
export function getQueueSnapshot(): QueueSnapshot {
  const tenantId = getActiveTenant();
  if (snapshot.tenantId !== tenantId) {
    void refreshQueueSnapshot();
    return EMPTY_SNAPSHOT;
  }
  return snapshot;
}

/** Rebuilds the cached snapshot from Dexie and notifies subscribers.
 * Awaited by every mutating entry point in this module, so tests never
 * have to race a fire-and-forget write (the leak #182 hit twice). */
export async function refreshQueueSnapshot(): Promise<void> {
  const tenantId = getActiveTenant();
  if (!tenantId) {
    if (snapshot !== EMPTY_SNAPSHOT) {
      snapshot = EMPTY_SNAPSHOT;
      notifyQueueChange();
    }
    return;
  }

  const { rows, readFailed } = await readTenantRows(tenantId);
  snapshot = {
    tenantId,
    total: rows.length,
    pending: rows.filter((row) => row.status === 'pending').length,
    conflict: rows.filter((row) => row.status === 'conflict').length,
    dead: rows.filter((row) => row.status === 'dead').length,
    rows,
    readFailed,
  };
  notifyQueueChange();
}

/** Every row of one tenant, ascending `seq`. The `tenantId` index — not
 * a filter over the whole table — so another tenant's rows are never
 * even read. */
async function readTenantRows(
  tenantId: string,
): Promise<{ rows: QueuedMutationRow[]; readFailed: boolean }> {
  const db = getOfflineDb();
  if (!db) return { rows: [], readFailed: false };
  try {
    const rows = await db.mutationQueue.where('tenantId').equals(tenantId).toArray();
    return { rows: rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), readFailed: false };
  } catch {
    // A read failure means "we cannot show the queue" — never "the queue
    // is empty and it is safe to proceed". Reporting an empty queue here
    // would tell the user, through 8.12.5's indicator, that everything
    // synced. `readFailed` is what lets that indicator say "can't read
    // your pending changes" instead of a reassuring zero.
    return { rows: [], readFailed: true };
  }
}

/**
 * Persists one mutation for later replay.
 *
 * Throws rather than resolving on every failure path: the caller is
 * about to tell the user "saved, will sync" and must not say that when
 * nothing was written.
 */
export async function enqueueMutation(input: EnqueueMutationInput): Promise<QueuedMutationRow> {
  // Before Dexie, before the tenant check — a forbidden path is a
  // programming error and should fail identically whether or not a user
  // happens to be logged in.
  if (FORBIDDEN_QUEUE_PATH.test(normalisePathForGuard(input.path))) {
    throw new ForbiddenQueueMutationError(input.path);
  }

  const tenantId = getActiveTenant();
  if (!tenantId) {
    throw new QueueUnavailableError('no tenant is active');
  }

  const db = getOfflineDb();
  if (!db) {
    throw new QueueUnavailableError('no offline database is available in this browser');
  }

  const row: QueuedMutationRow = {
    tenantId,
    entity: input.entity,
    method: input.method,
    path: input.path,
    body: input.body,
    enqueuedAt: Date.now(),
    attempts: 0,
    status: 'pending',
  };

  let seq: number;
  try {
    seq = await db.mutationQueue.add(row);
  } catch (error) {
    // Quota exhaustion and a schema `VersionError` are the realistic
    // failures here, and both must surface as the error this function
    // documents rather than as a raw Dexie type. The caller is about to
    // tell someone "saved, will sync" and is catching for exactly this.
    throw new QueueUnavailableError(messageOf(error));
  }
  await refreshQueueSnapshot();
  return { ...row, seq };
}

let inFlightReplay: Promise<void> | null = null;

/** Set when a replay is asked for while one is already running. The
 * in-flight pass may have already decided there was nothing to do —
 * `runReplay` reads the tenant and the rows once, at the top — so simply
 * joining it would swallow the trigger.
 *
 * That is not hypothetical: `startQueueReplay()` runs at boot, finds no
 * tenant, and returns early; login fires a microtask later, joins that
 * same settled-but-not-yet-cleared promise, and the queue never sends.
 * A re-run flag turns "join" into "join, then go round again". */
let replayRequested = false;

/**
 * Sends every `pending` row of the active tenant, oldest first, and
 * stops at the first row it cannot clear.
 *
 * Single-flight: an `online` event, a backoff timer and a manual call
 * can all land together, and sending a row twice is exactly the
 * duplicate-write this queue exists to avoid.
 */
export function replayQueue(): Promise<void> {
  if (inFlightReplay) {
    replayRequested = true;
    return inFlightReplay;
  }

  const replay = (async () => {
    do {
      replayRequested = false;
      await runReplay();
      // Loops only while something asked again *during* the pass. Each
      // iteration re-reads the tenant and the rows, so a login or a
      // tenant switch that landed mid-pass is picked up rather than lost.
    } while (replayRequested);
  })().finally(() => {
    if (inFlightReplay === replay) inFlightReplay = null;
  });

  inFlightReplay = replay;
  return replay;
}

async function runReplay(): Promise<void> {
  const tenantId = getActiveTenant();
  if (!tenantId) return;
  const db = getOfflineDb();
  if (!db) return;

  // All rows, not just `pending` ones, because a `conflict`/`dead` row
  // ahead in the queue has to *block* the rows behind it — querying
  // `[tenantId+status]` for `pending` alone would quietly step over it.
  const { rows, readFailed } = await readTenantRows(tenantId);
  // A read failure is not an empty queue. Proceeding would report a
  // successful no-op replay while the user's writes sat unread.
  if (readFailed) return;
  let changed = false;

  try {
    for (const row of rows) {
      if (row.seq === undefined) continue;
      // Head-of-line blocking, deliberately. See the header.
      if (row.status !== 'pending') break;

      // A tenant switch or a logout mid-replay must not send the rest of
      // the previous tenant's queue under the new tenant's `X-Tenant-ID`.
      if (getActiveTenant() !== tenantId) break;

      try {
        await apiClient.request({
          method: row.method,
          url: row.path,
          data: row.body,
          // `_retry: true` up front makes `client.ts`'s response
          // interceptor skip its refresh-then-`notifySessionExpired`
          // branch for this request. That branch is right for a request a
          // user is watching; it is catastrophic here. A token routinely
          // expires while a tab sits offline, so the *first* replayed row
          // 401s, the refresh fails, `clearAuthState()` runs — and
          // `deleteOfflineDb()` takes the entire queue with it. The user's
          // unsaved work is destroyed by the very act of trying to save
          // it, and nothing tells them. Replay instead treats a 401 as
          // "not authorised right now", stops, and leaves every row
          // untouched for the next attempt.
          _retry: true,
        } as Parameters<typeof apiClient.request>[0]);
        await db.mutationQueue.delete(row.seq);
        changed = true;
      } catch (error) {
        if (isNoResponseNetworkError(error)) {
          // Still offline. Not a strike: leave the row untouched, stop,
          // and wait for the next `online` event. Counting this would
          // dead-letter a perfectly good mutation for the crime of being
          // made in a lift.
          break;
        }

        const statusCode = statusCodeOf(error);

        if (statusCode === 401 || statusCode === 403) {
          // Not a strike, and not a dead-letter: the row is fine, the
          // session is not. Burning attempts here would dead-letter five
          // perfectly good mutations for the crime of being replayed
          // before the user re-authenticated. Stop and wait.
          break;
        }

        const lastError = describeFailure(error);
        changed = true;

        if (statusCode === 409 || statusCode === 412) {
          // The server says the record moved on. Overwriting it is the
          // silent data loss the acceptance criteria forbid, so a human
          // decides via 8.12.5's UI (`retryMutation`/`discardMutation`).
          await db.mutationQueue.update(row.seq, { status: 'conflict', lastError });
          break;
        }

        const attempts = row.attempts + 1;
        if (attempts >= MAX_REPLAY_ATTEMPTS) {
          await db.mutationQueue.update(row.seq, { status: 'dead', attempts, lastError });
          break;
        }

        await db.mutationQueue.update(row.seq, { attempts, lastError });
        scheduleBackoffReplay(attempts);
        break;
      }
    }
  } catch {
    // A Dexie write inside the loop (the delete on success, the status
    // updates on failure) can reject — `DatabaseClosedError` when a
    // logout lands mid-replay, or a quota error. `handleOnline` calls
    // this as `void replayQueue()`, so an escaping rejection becomes an
    // `unhandledrejection` that 8.12.7's Sentry handler reports. Stopping
    // the pass is the correct response either way: the next `online`
    // event or backoff tick retries from a clean read.
  } finally {
    if (changed) await refreshQueueSnapshot();
  }
}

/** `statusCode` is omitted rather than set to `undefined` — the project
 * runs `exactOptionalPropertyTypes`, and an absent status genuinely
 * means "we never got one" rather than "the status was nothing". */
function describeFailure(error: unknown): NonNullable<QueuedMutationRow['lastError']> {
  const statusCode = statusCodeOf(error);
  const message = messageOf(error);
  return statusCode === undefined ? { message } : { statusCode, message };
}

function statusCodeOf(error: unknown): number | undefined {
  // `toApiError` (`client.ts`) has already wrapped anything with a
  // recognisable server body; the axios fallback covers a real HTTP
  // response whose body was not the server's error shape (a proxy's 502
  // HTML page, say).
  if (error instanceof ApiError) return error.statusCode;
  if (axios.isAxiosError(error)) return error.response?.status;
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let started = false;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeAuth: (() => void) | null = null;

function handleOnline(): void {
  void replayQueue();
}

/**
 * Wires the queue to the browser's `online` event plus a backoff timer.
 *
 * Explicit registration, not an import side effect — the same rule the
 * lazy Dexie handle follows. Importing `@biddaloy/ui/api` must not start
 * background network activity in a test, an SSR pass, or an app that
 * never queues anything.
 */
export function startQueueReplay(): void {
  if (started) return;
  started = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }
  // Also on every auth-state change, not just `online`. `startQueueReplay()`
  // is called once at app boot, when there is no tenant yet — and
  // `runReplay` returns immediately without one. With only the `online`
  // listener (which fires on a connectivity *transition*, not at login),
  // rows queued in a previous session would sit unsent indefinitely: the
  // `started` latch made a second call after login a no-op, so nothing
  // ever tried again. This is also what makes 8.12.5's "try again" button
  // and a switch back to a tenant with queued rows actually send anything.
  unsubscribeAuth = subscribeAuthState(() => {
    if (isOnline()) void replayQueue();
  });
  if (isOnline()) void replayQueue();
}

export function stopQueueReplay(): void {
  started = false;
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnline);
  }
  if (backoffTimer !== null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Retries a retryable server failure after `min(2^attempts s, 60s)`.
 *
 * The timer captures the session generation and re-checks it when it
 * fires: a timer armed for one user must never send that user's queued
 * writes after somebody else has logged into the same browser. The same
 * class of leak an un-awaited delete caused in #182, arrived at from the
 * other direction.
 *
 * Bounded overall by `MAX_REPLAY_ATTEMPTS`: once a row is dead it blocks
 * the queue instead of rescheduling, so nothing spins forever.
 */
function scheduleBackoffReplay(attempts: number): void {
  if (!started || backoffTimer !== null) return;
  const generation = currentSessionGeneration();
  const delay = Math.min(2 ** attempts * 1000, MAX_REPLAY_BACKOFF_MS);
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    if (!started) return;
    if (currentSessionGeneration() !== generation) return;
    if (!isOnline()) return;
    void replayQueue();
  }, delay);
}

/** Puts a `conflict`/`dead` row back in the queue with a clean slate —
 * what 8.12.5's "try again" button calls after the user has looked at
 * the conflict. Scoped to the active tenant so a stale `seq` from
 * another school cannot be resurrected. */
export async function retryMutation(seq: number): Promise<void> {
  const db = getOfflineDb();
  const tenantId = getActiveTenant();
  if (!db || !tenantId) return;
  const row = await db.mutationQueue.get(seq);
  if (!row || row.tenantId !== tenantId) return;
  // `modify`, not `update`: the old failure message has to be *removed*,
  // and an `update` under `exactOptionalPropertyTypes` cannot express
  // "delete this optional property".
  await db.mutationQueue
    .where(':id')
    .equals(seq)
    .modify((stored) => {
      stored.status = 'pending';
      stored.attempts = 0;
      delete stored.lastError;
    });
  await refreshQueueSnapshot();
  // Actually try again. Without this the button behind it resets a row to
  // `pending` and then waits for an `online` transition that may never
  // come — a "Try again" that visibly does nothing.
  if (isOnline()) await replayQueue();
}

/** Throws the row away — "discard my change" once the user has seen what
 * it was. The only path that destroys queued work on purpose. */
export async function discardMutation(seq: number): Promise<void> {
  const db = getOfflineDb();
  const tenantId = getActiveTenant();
  if (!db || !tenantId) return;
  const row = await db.mutationQueue.get(seq);
  if (!row || row.tenantId !== tenantId) return;
  await db.mutationQueue.delete(seq);
  await refreshQueueSnapshot();
}

/** Test-only: drops the cached snapshot and any armed timer so each test
 * starts from a cold module, the way `resetOfflineDbForTests` does for
 * the database handle. */
export function resetMutationQueueForTests(): void {
  stopQueueReplay();
  inFlightReplay = null;
  replayRequested = false;
  snapshot = EMPTY_SNAPSHOT;
}
