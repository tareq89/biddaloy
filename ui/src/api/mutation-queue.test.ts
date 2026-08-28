/**
 * [8.12.4]. The properties worth testing here are the ones a reviewer
 * cannot eyeball:
 *
 * - a financial mutation cannot be queued — twice over, once by the
 *   compiler (the `@ts-expect-error` block, which fails `tsc --noEmit`
 *   if the union is ever opened) and once at runtime;
 * - replay order is submission order, and a blocked row stops the ones
 *   behind it rather than letting them overtake;
 * - a permanently failing row dead-letters instead of retrying forever,
 *   while merely being offline never counts as a strike;
 * - tenant A's queued work is invisible and unsendable under tenant B.
 *
 * IndexedDB is `fake-indexeddb`, installed globally in
 * `ui/src/test/setup.ts` — a real implementation, so the index and
 * auto-increment behaviour the ordering guarantee rests on is genuinely
 * exercised rather than stubbed.
 */
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, setActiveTenant } from './auth-state';
import { apiClient } from './client';
import { ApiError } from './errors';
import {
  discardMutation,
  enqueueMutation,
  ForbiddenQueueMutationError,
  getQueueSnapshot,
  MAX_REPLAY_ATTEMPTS,
  QueueUnavailableError,
  refreshQueueSnapshot,
  replayQueue,
  resetMutationQueueForTests,
  retryMutation,
  startQueueReplay,
  stopQueueReplay,
  subscribeQueueChanges,
} from './mutation-queue';
import { deleteOfflineDb, getOfflineDb, resetOfflineDbForTests } from './offline-db';
import { captureQueueFailure } from './sentry';

// [8.12.7]: the queue reports its own IndexedDB failures, because it
// catches them itself — nothing here ever reaches Sentry's global
// handlers. Mocked rather than driven through the real module so these
// tests do not depend on its once-per-session latch.
vi.mock('./sentry', () => ({
  captureQueueFailure: vi.fn(),
}));

/** The shape axios produces when the request never reached a server:
 * `response` is `undefined`. A real `AxiosError`, not a hand-rolled
 * object, because `axios.isAxiosError` checks a brand. */
function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK, {
    headers: new AxiosHeaders(),
  });
}

function serverError(statusCode: number, message = 'boom'): ApiError {
  return new ApiError({
    statusCode,
    message,
    timestamp: '2026-08-28T00:00:00.000Z',
    path: '/api/v1/attendance',
    requestId: 'req-1',
  });
}

beforeEach(async () => {
  // Drains any delete still in flight from a previous test's global
  // cleanup — while one is pending `getOfflineDb()` deliberately returns
  // `null`, so without this a test gets no database through no fault of
  // its own. Same reason `offline-cache.test.ts` does it.
  await deleteOfflineDb();
  resetMutationQueueForTests();
  setActiveTenant('tenant-a');
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetMutationQueueForTests();
  clearAuthState();
  await deleteOfflineDb();
});

function queue(path = '/attendance', body: unknown = { present: true }) {
  return enqueueMutation({ entity: 'attendance', method: 'post', path, body });
}

describe('the financial-mutation exclusion', () => {
  it('is a compile error, not a code-review catch', () => {
    // These lines are the test. If `QueueableEntity` is ever widened to
    // include money, `@ts-expect-error` becomes an unused suppression
    // and `yarn lint`'s `tsc --noEmit` fails the build — which is the
    // whole point of the union being closed.
    // @ts-expect-error payments must never be queued
    void (() => enqueueMutation({ entity: 'payments', method: 'post', path: '/x' }));
    // @ts-expect-error fee generation must never be queued
    void (() => enqueueMutation({ entity: 'fee-generation', method: 'post', path: '/x' }));
    // @ts-expect-error invoices must never be queued
    void (() => enqueueMutation({ entity: 'invoices', method: 'post', path: '/x' }));
    // @ts-expect-error enrolment changes must never be queued
    void (() => enqueueMutation({ entity: 'enrollments', method: 'patch', path: '/x' }));

    expect(true).toBe(true);
  });

  it.each([
    '/payments',
    '/payments/123',
    '/payments?studentId=1',
    '/fees/generate',
    '/invoices/123',
    '/enrollments',
    '/enrollments/9/transfer',
    // Spellings that reached the real controller before the guard was
    // normalised. Axios resolves a relative path against the base URL,
    // so `payments/123` still hits `/api/v1/payments/123`; and Express —
    // Nest's default adapter — routes case-insensitively, so `/PAYMENTS`
    // hits the payments controller too. Both enqueued successfully once,
    // which made the runtime half of this guard decorative.
    'payments/123',
    '/PAYMENTS/123',
    'invoices',
    '/Fees/Generate',
  ])('rejects the path %s at runtime, before anything is persisted', async (path) => {
    // `path` is a plain string that consumers build at runtime, so the
    // closed union above cannot see it. A queued payment replayed hours
    // later — after the parent has walked out with a receipt — is
    // unrecoverable, so this refuses rather than trusts.
    await expect(
      enqueueMutation({ entity: 'attendance', method: 'post', path }),
    ).rejects.toBeInstanceOf(ForbiddenQueueMutationError);

    await expect((await getOfflineDb())!.mutationQueue.count()).resolves.toBe(0);
  });

  it('does not false-positive on a fees sub-path that is not generation', async () => {
    // `/fees/dues` is a read and would never be queued anyway; the
    // regex being provably segment-anchored is what stops someone
    // loosening it later for the wrong reason.
    await expect(queue('/fees/dues')).resolves.toMatchObject({ path: '/fees/dues' });
  });
});

describe('enqueueMutation', () => {
  it('refuses to pretend it saved when there is no tenant', async () => {
    setActiveTenant(null);
    // Resolving here would let the caller tell the user "saved, will
    // sync" about a write that went nowhere.
    await expect(queue()).rejects.toBeInstanceOf(QueueUnavailableError);
  });

  it('refuses to pretend it saved when there is no IndexedDB', async () => {
    resetOfflineDbForTests();
    vi.stubGlobal('indexedDB', undefined);

    await expect(queue()).rejects.toBeInstanceOf(QueueUnavailableError);

    vi.unstubAllGlobals();
    resetOfflineDbForTests();
  });

  it('survives dropping the database handle, the way a restart drops it', async () => {
    await queue('/attendance/1');
    await queue('/attendance/2');
    await queue('/attendance/3');

    // As close as jsdom gets to "close the tab and come back": the
    // memoized connection is thrown away and a fresh one opened.
    resetOfflineDbForTests();
    resetMutationQueueForTests();

    const rows = await (await getOfflineDb())!.mutationQueue.orderBy('seq').toArray();
    expect(rows.map((row) => row.path)).toEqual([
      '/attendance/1',
      '/attendance/2',
      '/attendance/3',
    ]);
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
  });

  it('notifies subscribers so a sync indicator can re-render', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeQueueChanges(listener);

    await queue();

    expect(listener).toHaveBeenCalled();
    expect(getQueueSnapshot()).toMatchObject({ tenantId: 'tenant-a', total: 1, pending: 1 });

    unsubscribe();
  });
});

describe('replayQueue', () => {
  it('sends in submission order', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    await queue('/attendance/1');
    await queue('/attendance/2');
    await queue('/attendance/3');

    await replayQueue();

    expect(request.mock.calls.map(([config]) => config.url)).toEqual([
      '/attendance/1',
      '/attendance/2',
      '/attendance/3',
    ]);
    // Cleared rows are deleted, not marked done — a queue that only ever
    // grows is a storage leak.
    await expect((await getOfflineDb())!.mutationQueue.count()).resolves.toBe(0);
  });

  it('sends each row once even when several triggers fire together', async () => {
    // An `online` event, a backoff timer and a manual call can all land
    // in the same tick; sending twice is the duplicate write this queue
    // exists to prevent.
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    await queue('/attendance/1');

    await Promise.all([replayQueue(), replayQueue(), replayQueue()]);

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('leaves everything pending while the transport is still down', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue(networkError());
    await queue('/attendance/1');
    await queue('/attendance/2');

    await replayQueue();

    const rows = await (await getOfflineDb())!.mutationQueue.orderBy('seq').toArray();
    // Being offline is not a strike — counting it would dead-letter a
    // perfectly good mutation for the crime of being made in a lift.
    expect(rows.map((row) => [row.status, row.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
    ]);
  });

  it.each([409, 412])('parks a %i as a conflict and stops the queue behind it', async (status) => {
    const request = vi
      .spyOn(apiClient, 'request')
      .mockRejectedValue(serverError(status, 'already marked'));
    await queue('/attendance/1');
    await queue('/attendance/2');

    await replayQueue();

    const rows = await (await getOfflineDb())!.mutationQueue.orderBy('seq').toArray();
    expect(rows[0]).toMatchObject({
      status: 'conflict',
      lastError: { statusCode: status, message: 'already marked' },
    });
    // Head-of-line blocking: row 2 very likely edits the same record as
    // row 1, so applying it over an unresolved conflict would be exactly
    // the silent overwrite the acceptance criteria forbid.
    expect(rows[1]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps a conflicted row blocking on later replays too', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(409));
    await queue('/attendance/1');
    await queue('/attendance/2');
    await replayQueue();

    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    await replayQueue();

    expect(request).not.toHaveBeenCalled();
  });

  it('dead-letters after a finite number of server failures', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(500, 'database is on fire'));
    await queue('/attendance/1');

    for (let attempt = 0; attempt < MAX_REPLAY_ATTEMPTS; attempt += 1) {
      await replayQueue();
    }

    const row = (await (await getOfflineDb())!.mutationQueue.orderBy('seq').first())!;
    // Kept, not dropped: the row is the user's work, and 8.12.5's UI
    // offers retry/discard with this message attached.
    expect(row).toMatchObject({
      status: 'dead',
      attempts: MAX_REPLAY_ATTEMPTS,
      lastError: { statusCode: 500, message: 'database is on fire' },
    });
    expect(getQueueSnapshot().dead).toBe(1);
  });

  it('stops calling the server once a row is dead', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(500));
    await queue('/attendance/1');
    for (let attempt = 0; attempt < MAX_REPLAY_ATTEMPTS; attempt += 1) await replayQueue();

    const request = vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(500));
    await replayQueue();

    // The cap is what stops a permanently broken item spinning against
    // the server for the life of the tab.
    expect(request).not.toHaveBeenCalled();
  });

  it('reads a status off a bodyless HTTP failure too', async () => {
    // Not every failure carries the server's error shape — a proxy's
    // 409 HTML page still means "conflict".
    const config = { headers: new AxiosHeaders() };
    const error = new AxiosError('Conflict', 'ERR_BAD_REQUEST', config, undefined, {
      status: 409,
      statusText: 'Conflict',
      data: '<html>nope</html>',
      headers: new AxiosHeaders(),
      config,
    });
    vi.spyOn(apiClient, 'request').mockRejectedValue(error);
    await queue();

    await replayQueue();

    await expect(
      (await getOfflineDb())!.mutationQueue.orderBy('seq').first(),
    ).resolves.toMatchObject({
      status: 'conflict',
    });
  });
});

describe('a replay must not destroy the work it is replaying', () => {
  it('does not tear down the session — and the queue with it — on a 401', async () => {
    // The scenario: a tab sits offline long enough for the token to
    // expire, then reconnects. The first replayed row 401s. Left to the
    // normal interceptor that means refresh, refresh fails,
    // `clearAuthState()` runs, and `deleteOfflineDb()` deletes the whole
    // database — so the user's unsaved work is destroyed by the act of
    // trying to save it, silently. The row must survive instead.
    await queue('/attendance', { present: true });
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(401, 'token expired'));

    await replayQueue();

    const rows = await (await getOfflineDb())!.mutationQueue.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    // Not a strike either: five replays before the user gets round to
    // logging back in must not dead-letter a perfectly good mutation.
    expect(rows[0]!.attempts).toBe(0);
  });

  it('treats a 403 the same way', async () => {
    await queue();
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(403, 'forbidden'));

    await replayQueue();

    const rows = await (await getOfflineDb())!.mutationQueue.toArray();
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.attempts).toBe(0);
  });

  it('[8.12.7] does not strike a row whose send succeeded but whose delete failed', async () => {
    // The bug this fixes: the success-path `delete` used to sit inside
    // the same `try` as the request, so a database closed by a logout
    // read as "the mutation failed". Five such passes dead-lettered a
    // row the server had already accepted — and told the user their work
    // could not be saved when it had been.
    const row = await queue();
    vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    const dexieError = new Error('DatabaseClosedError');
    vi.spyOn((await getOfflineDb())!.mutationQueue, 'delete').mockRejectedValue(dexieError);

    await expect(replayQueue()).resolves.toBeUndefined();

    const stored = await (await getOfflineDb())!.mutationQueue.get(row.seq!);
    expect(stored?.attempts).toBe(0);
    expect(stored?.status).toBe('pending');
    expect(stored?.lastError).toBeUndefined();
    expect(captureQueueFailure).toHaveBeenCalledWith(dexieError);
  });

  it('stops cleanly when a database write fails mid-replay, and reports it', async () => {
    // A logout landing mid-replay closes the database under the loop.
    // The pass has to stop — but stopping silently means a queue that
    // never drains again, invisible to the user and to us. [8.12.7]:
    // this `catch` is exactly why nothing ever reached Sentry's global
    // `unhandledrejection` handler, so the report is explicit.
    await queue();
    // A failed request, so the loop takes its status-update write — the
    // write that a closed database rejects.
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(500));
    const dexieError = new Error('DatabaseClosedError');
    vi.spyOn((await getOfflineDb())!.mutationQueue, 'update').mockRejectedValue(dexieError);

    await expect(replayQueue()).resolves.toBeUndefined();

    expect(captureQueueFailure).toHaveBeenCalledWith(dexieError);
    // The error itself, never the row or its body — a queued mutation's
    // payload is user-authored content.
    expect(vi.mocked(captureQueueFailure).mock.calls[0]).toHaveLength(1);
  });
});

describe('replay actually gets triggered', () => {
  it('replays rows queued before login, once a tenant appears', async () => {
    // `startQueueReplay()` runs once at app boot, before any tenant
    // exists — and replay is a no-op without one. The `started` latch
    // then made a second call after login do nothing, and the `online`
    // event only fires on a connectivity *transition*, not at login. So
    // rows from a previous session sat unsent forever.
    await queue();
    stopQueueReplay();
    setActiveTenant(null);

    startQueueReplay();
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });

    setActiveTenant('tenant-a');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    stopQueueReplay();
  });

  it('sends again when a conflicted row is retried', async () => {
    // Otherwise 8.12.5's "Try again" resets the row and then waits for an
    // online transition that may never come — a button that visibly does
    // nothing.
    const row = await queue();
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(409, 'moved on'));
    await replayQueue();
    expect((await (await getOfflineDb())!.mutationQueue.get(row.seq!))!.status).toBe('conflict');

    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    await retryMutation(row.seq!);

    expect(request).toHaveBeenCalledTimes(1);
    await expect((await getOfflineDb())!.mutationQueue.count()).resolves.toBe(0);
  });
});

describe('a snapshot must not claim an empty queue it could not read', () => {
  it('reports readFailed rather than a reassuring zero', async () => {
    await queue();
    vi.spyOn((await getOfflineDb())!.mutationQueue, 'where').mockImplementation(() => {
      throw new Error('IDB read failed');
    });

    await refreshQueueSnapshot();

    const snapshot = getQueueSnapshot();
    expect(snapshot.readFailed).toBe(true);
    // [8.12.7]: swallowed here so the indicator can degrade gracefully,
    // so it has to be reported deliberately or an unreadable database is
    // never heard about.
    expect(captureQueueFailure).toHaveBeenCalledWith(expect.any(Error));
    // "You have no unsynced changes" and "I cannot tell whether you have
    // unsynced changes" must not look the same to someone deciding
    // whether it is safe to close the tab.
    expect(snapshot.total).toBe(0);
  });

  it('does not report a successful no-op replay when the queue is unreadable', async () => {
    await queue();
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    vi.spyOn((await getOfflineDb())!.mutationQueue, 'where').mockImplementation(() => {
      throw new Error('IDB read failed');
    });

    await replayQueue();

    expect(request).not.toHaveBeenCalled();
  });
});

describe('enqueue failures are distinguishable', () => {
  it('reports a storage failure as QueueUnavailableError, not a raw Dexie error', async () => {
    // The caller is about to tell someone "saved, will sync" and catches
    // this specific error to avoid saying it.
    vi.spyOn((await getOfflineDb())!.mutationQueue, 'add').mockRejectedValue(
      new DOMException('quota', 'QuotaExceededError'),
    );

    await expect(queue()).rejects.toBeInstanceOf(QueueUnavailableError);
  });
});

describe('tenant scoping', () => {
  it('never sends or counts another tenant’s queued work', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    await queue('/attendance/a');

    setActiveTenant('tenant-b');
    await refreshQueueSnapshot();

    expect(getQueueSnapshot()).toMatchObject({ tenantId: 'tenant-b', total: 0 });
    await replayQueue();
    // `apiClient` stamps `X-Tenant-ID` from the *active* tenant, so
    // sending school A's row here would file it against school B.
    expect(request).not.toHaveBeenCalled();
  });

  it('gives the work back when the user switches back', async () => {
    await queue('/attendance/a');
    setActiveTenant('tenant-b');
    await refreshQueueSnapshot();

    setActiveTenant('tenant-a');
    await refreshQueueSnapshot();

    // Queued mutations are unsaved work, not a reproducible cache — a
    // switch isolates them, it does not destroy them.
    expect(getQueueSnapshot()).toMatchObject({ tenantId: 'tenant-a', total: 1, pending: 1 });
  });
});

describe('retryMutation / discardMutation', () => {
  it('retry puts a conflicted row back in the queue with a clean slate', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(409));
    const row = await queue('/attendance/1');
    await replayQueue();

    // Offline while retrying, so the row is reset and then left alone —
    // `retryMutation` now sends immediately (a "Try again" that waits for
    // an `online` event that may never come is a button that does
    // nothing), and this asserts the reset state rather than the outcome
    // of that send.
    vi.spyOn(apiClient, 'request').mockRejectedValue(networkError());
    await retryMutation(row.seq!);

    const stored = (await (await getOfflineDb())!.mutationQueue.get(row.seq!))!;
    expect(stored).toMatchObject({ status: 'pending', attempts: 0 });
    expect(stored.lastError).toBeUndefined();
  });

  it('discard throws the row away, and only that row', async () => {
    const first = await queue('/attendance/1');
    await queue('/attendance/2');

    await discardMutation(first.seq!);

    const rows = await (await getOfflineDb())!.mutationQueue.orderBy('seq').toArray();
    expect(rows.map((r) => r.path)).toEqual(['/attendance/2']);
  });

  it('ignores a seq belonging to another tenant', async () => {
    const row = await queue('/attendance/1');
    setActiveTenant('tenant-b');

    await discardMutation(row.seq!);

    // A stale id from another school must not be able to delete work
    // this session cannot even see.
    await expect((await getOfflineDb())!.mutationQueue.count()).resolves.toBe(1);
  });
});

describe('the backoff timer must not fire into the wrong session', () => {
  afterEach(() => {
    stopQueueReplay();
    vi.useRealTimers();
  });

  function useBackoffTimers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  }

  /** Drives one server failure, which is what arms the backoff timer. */
  async function armBackoff() {
    await queue();
    startQueueReplay();
    vi.spyOn(apiClient, 'request').mockRejectedValue(serverError(500, 'boom'));
    await replayQueue();
  }

  it('does not replay after the session it was armed in has ended', async () => {
    // Same guard as the autosave debounce: a timer armed for one user must
    // never send that user's writes after somebody else has logged in.
    // Only the timer functions the backoff itself uses. Faking the whole
    // clock also stalls `fake-indexeddb`, which drives its requests off
    // microtask/immediate scheduling — every Dexie call would hang.
    useBackoffTimers();
    await armBackoff();
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });

    clearAuthState();
    setActiveTenant('tenant-a');
    await vi.advanceTimersByTimeAsync(120_000);

    expect(request).not.toHaveBeenCalled();
  });

  it('does not replay while still offline', async () => {
    // Only the timer functions the backoff itself uses. Faking the whole
    // clock also stalls `fake-indexeddb`, which drives its requests off
    // microtask/immediate scheduling — every Dexie call would hang.
    useBackoffTimers();
    await armBackoff();
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

    try {
      await vi.advanceTimersByTimeAsync(120_000);
      expect(request).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'onLine');
    }
  });

  it('does not replay once replay has been stopped', async () => {
    // Only the timer functions the backoff itself uses. Faking the whole
    // clock also stalls `fake-indexeddb`, which drives its requests off
    // microtask/immediate scheduling — every Dexie call would hang.
    useBackoffTimers();
    await armBackoff();
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });

    stopQueueReplay();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(request).not.toHaveBeenCalled();
  });

  it('retries once the backoff elapses in the same session', async () => {
    // Only the timer functions the backoff itself uses. Faking the whole
    // clock also stalls `fake-indexeddb`, which drives its requests off
    // microtask/immediate scheduling — every Dexie call would hang.
    useBackoffTimers();
    await armBackoff();
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: null });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(request).toHaveBeenCalled();
  });
});

describe('snapshot and error-shape edges', () => {
  it('returns the stable empty snapshot when the active tenant has moved on', () => {
    // Identity matters, not just contents: `useSyncExternalStore` loops
    // forever if `getSnapshot` returns a fresh object each call.
    setActiveTenant('tenant-z');

    const first = getQueueSnapshot();
    const second = getQueueSnapshot();

    expect(first.total).toBe(0);
    expect(first).toBe(second);
  });

  it('clears the snapshot when there is no tenant at all', async () => {
    await queue();
    await refreshQueueSnapshot();
    expect(getQueueSnapshot().total).toBe(1);

    setActiveTenant(null);
    await refreshQueueSnapshot();

    expect(getQueueSnapshot().total).toBe(0);
  });

  it('records a non-Error rejection without crashing on it', async () => {
    // Anything can be thrown. `messageOf`/`statusCodeOf` have to cope with
    // a string as readily as with an `ApiError`, because a row's
    // `lastError` is what the sync panel shows the user.
    await queue();
    vi.spyOn(apiClient, 'request').mockRejectedValue('plain string failure');

    await replayQueue();

    const row = (await (await getOfflineDb())!.mutationQueue.orderBy('seq').first())!;
    expect(row.lastError?.message).toBe('plain string failure');
    expect(row.lastError?.statusCode).toBeUndefined();
  });

  it('records a bodyless axios failure that still carries a response status', async () => {
    await queue();
    const err = new AxiosError('Bad Gateway', 'ERR_BAD_RESPONSE', { headers: new AxiosHeaders() });
    err.response = { status: 502 } as never;
    vi.spyOn(apiClient, 'request').mockRejectedValue(err);

    await replayQueue();

    const row = (await (await getOfflineDb())!.mutationQueue.orderBy('seq').first())!;
    expect(row.lastError?.statusCode).toBe(502);
  });
});
