import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutosave } from './autosave';

interface TestCell {
  value: string;
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces staged cells into one batch call', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave<TestCell>({ save, debounceMs: 500 }));

    act(() => {
      result.current.stage('a', { value: '1' });
      result.current.stage('b', { value: '2' });
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    const batch = save.mock.calls[0]![0] as Map<string, TestCell>;
    expect(batch.size).toBe(2);
  });

  it('reports pendingCount accurately and clears it once saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave<TestCell>({ save, debounceMs: 100 }));

    act(() => result.current.stage('a', { value: '1' }));
    expect(result.current.pendingCount).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.pendingCount).toBe(0);
    expect(result.current.state).toBe('saved');
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it('retries a failed batch with backoff and keeps the value staged', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave<TestCell>({ save, debounceMs: 100, retryBaseMs: 1000 }),
    );

    act(() => result.current.stage('a', { value: '1' }));

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe('error');
    // Never discarded — the value is still pending, just marked failed.
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.failedKeys.has('a')).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe('saved');
    expect(result.current.pendingCount).toBe(0);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('useAutosave — edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance fake time and let any resolved/rejected save promises settle. */
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** A save() whose promise the test resolves or rejects by hand. */
  function deferredSave() {
    const resolvers: Array<() => void> = [];
    const save = vi.fn<(cells: Map<string, TestCell>) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    return { save, resolveCall: (n: number) => resolvers[n]!() };
  }

  it('uses a 600ms debounce by default', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave<TestCell>({ save }));

    act(() => result.current.stage('a', { value: '1' }));

    await advance(599);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing staged does not call save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave<TestCell>({ save }));

    await act(async () => {
      await result.current.flush();
    });

    expect(save).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('flush sends staged cells immediately without waiting for the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave<TestCell>({ save, debounceMs: 5000 }));

    act(() => result.current.stage('a', { value: '1' }));
    await act(async () => {
      await result.current.flush();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('saved');

    // The cancelled debounce timer must not fire a second save later.
    await advance(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never sends a second batch while one is still in flight', async () => {
    const { save, resolveCall } = deferredSave();
    const { result } = renderHook(() => useAutosave<TestCell>({ save }));

    act(() => result.current.stage('a', { value: '1' }));
    act(() => void result.current.flush());
    expect(result.current.state).toBe('saving');

    act(() => void result.current.flush());
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCall(0);
      await Promise.resolve();
    });
    expect(result.current.state).toBe('saved');
  });

  // Submit awaits flush() and then locks the grid server-side, so flush
  // must not resolve while anything is still unsaved.
  it('flush waits out an in-flight batch, then sends edits made mid-flight, and resolves true', async () => {
    const { save, resolveCall } = deferredSave();
    const { result } = renderHook(() => useAutosave<TestCell>({ save }));

    act(() => result.current.stage('a', { value: '1' }));
    act(() => void result.current.flush());
    act(() => result.current.stage('b', { value: '2' }));

    let flushed: boolean | undefined;
    act(() => {
      void result.current.flush().then((ok) => {
        flushed = ok;
      });
    });

    await act(async () => {
      resolveCall(0);
      await Promise.resolve();
    });
    // First batch done, but 'b' is still unsaved — flush has not resolved.
    expect(flushed).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].get('b')).toEqual({ value: '2' });

    await act(async () => {
      resolveCall(1);
      await Promise.resolve();
    });
    expect(flushed).toBe(true);
    expect(result.current.pendingCount).toBe(0);
  });

  it('flush resolves false when the save fails, so a caller knows not to submit', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useAutosave<TestCell>({ save }));

    act(() => result.current.stage('a', { value: '1' }));
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe(false);
    expect(result.current.state).toBe('error');
    expect(result.current.failedKeys.has('a')).toBe(true);
  });

  it('keeps an edit made while a save is in flight and sends it next', async () => {
    const { save, resolveCall } = deferredSave();
    const { result } = renderHook(() => useAutosave<TestCell>({ save }));

    act(() => result.current.stage('a', { value: '1' }));
    act(() => void result.current.flush());
    // The user edits the same cell again before the first save returns.
    act(() => result.current.stage('a', { value: '2' }));

    await act(async () => {
      resolveCall(0);
      await Promise.resolve();
    });

    // The newer value was not cleared — it is still pending and a
    // follow-up save carrying it went out straight away.
    expect(result.current.pendingKeys.has('a')).toBe(true);
    expect(result.current.state).toBe('saving');
    expect(save).toHaveBeenCalledTimes(2);
    const secondBatch = save.mock.calls[1]![0];
    expect(secondBatch.get('a')).toEqual({ value: '2' });

    await act(async () => {
      resolveCall(1);
      await Promise.resolve();
    });
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.state).toBe('saved');
  });

  it('doubles the retry delay after each failure, capped at maxRetryMs', async () => {
    const save = vi.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(() =>
      useAutosave<TestCell>({ save, debounceMs: 100, retryBaseMs: 1000, maxRetryMs: 1500 }),
    );

    act(() => result.current.stage('a', { value: '1' }));
    await advance(100);
    expect(save).toHaveBeenCalledTimes(1);

    // Retry 1 waits the base delay (1000ms).
    await advance(999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(2);

    // Retry 2 would wait 2000ms, but the cap holds it to 1500ms.
    await advance(1499);
    expect(save).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(result.current.state).toBe('error');
  });

  it('a fresh edit to a failed cell clears its failed flag and cancels the retry backoff', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave<TestCell>({ save, debounceMs: 100, retryBaseMs: 1000 }),
    );

    act(() => result.current.stage('a', { value: '1' }));
    await advance(100);
    expect(result.current.failedKeys.has('a')).toBe(true);

    act(() => result.current.stage('a', { value: '2' }));
    expect(result.current.failedKeys.has('a')).toBe(false);

    // The new edit goes out on the normal debounce...
    await advance(100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('saved');

    // ...and the old 1000ms retry never fires.
    await advance(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flush during a retry backoff sends right away instead of waiting', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave<TestCell>({ save, debounceMs: 100, retryBaseMs: 10000 }),
    );

    act(() => result.current.stage('a', { value: '1' }));
    await advance(100);
    expect(result.current.state).toBe('error');

    await act(async () => {
      await result.current.flush();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('saved');
    expect(result.current.failedKeys.size).toBe(0);
  });

  it('cancels a pending debounced save when the component unmounts', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave<TestCell>({ save, debounceMs: 100 }));

    act(() => result.current.stage('a', { value: '1' }));
    unmount();
    await vi.advanceTimersByTimeAsync(1000);

    expect(save).not.toHaveBeenCalled();
  });

  it('cancels a pending retry when the component unmounts', async () => {
    const save = vi.fn().mockRejectedValue(new Error('network'));
    const { result, unmount } = renderHook(() =>
      useAutosave<TestCell>({ save, debounceMs: 100, retryBaseMs: 1000 }),
    );

    act(() => result.current.stage('a', { value: '1' }));
    await advance(100);
    expect(save).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(5000);

    expect(save).toHaveBeenCalledTimes(1);
  });
});
