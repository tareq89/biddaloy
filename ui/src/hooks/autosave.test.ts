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
