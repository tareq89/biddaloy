import { useQuery } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccessToken, getActiveRole, getActiveTenant } from '../api/auth-state';

import { mockOnlineStatus, resetOnlineStatus } from './connectivity';
import { renderHookWithProviders } from './render-hook-with-providers';

// Stand-ins for hooks this ticket's own scope doesn't build yet
// (useDebounce, useOnline, ...) — these prove renderHookWithProviders and
// the fake-timer/connectivity utilities work correctly, the same way
// a11y.test.tsx proves its matchers against ad-hoc components rather than
// production ones that don't exist yet.

function useAuthProbe() {
  return {
    tenant: getActiveTenant(),
    role: getActiveRole(),
    token: getAccessToken(),
  };
}

function useSeededQuery(queryKey: readonly unknown[]) {
  return useQuery({ queryKey, queryFn: () => Promise.reject(new Error('should not fetch')) });
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function useThrottledCallback(callback: () => void, intervalMs: number): () => void {
  const [lastCall, setLastCall] = useState(0);
  return () => {
    const now = Date.now();
    if (now - lastCall >= intervalMs) {
      setLastCall(now);
      callback();
    }
  };
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  return online;
}

describe('renderHookWithProviders', () => {
  it('mirrors renderWithProviders: tenant/role/token options apply', () => {
    const { result } = renderHookWithProviders(useAuthProbe, {
      tenantId: 'tenant-1',
      role: 'teacher',
      accessToken: 'token-abc',
    });

    expect(result.current).toEqual({ tenant: 'tenant-1', role: 'teacher', token: 'token-abc' });
  });

  it('mirrors renderWithProviders: seeded query data is readable with no fetch', async () => {
    const { result } = renderHookWithProviders(() => useSeededQuery(['seeded']), {
      seedQueries: [{ queryKey: ['seeded'], data: 'cached-value' }],
    });

    await waitFor(() => expect(result.current.data).toBe('cached-value'));
    expect(result.current.status).toBe('success');
  });

  it('gives each call a fresh QueryClient by default', () => {
    const first = renderHookWithProviders(useAuthProbe);
    const second = renderHookWithProviders(useAuthProbe);

    expect(first.queryClient).not.toBe(second.queryClient);
  });

  it('supports rerender-with-new-props for a hook that reacts to argument changes', () => {
    const { result, rerender } = renderHookWithProviders(
      ({ value }: { value: number }) => value * 2,
      {
        initialProps: { value: 1 },
      },
    );

    expect(result.current).toBe(2);
    rerender({ value: 5 });
    expect(result.current).toBe(10);
  });
});

describe('debounce/throttle hooks are testable with fake timers — no real waiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a debounced value only updates after the delay elapses, advanced synthetically', () => {
    const { result, rerender } = renderHookWithProviders(
      ({ value }: { value: string }) => useDebouncedValue(value, 500),
      { initialProps: { value: 'first' } },
    );

    expect(result.current).toBe('first');

    rerender({ value: 'second' });
    expect(result.current).toBe('first'); // not yet — delay hasn't elapsed

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe('first');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('second');
  });

  it('a throttled callback fires at most once per interval, advanced synthetically', () => {
    const onFire = vi.fn();
    const { result } = renderHookWithProviders(() => useThrottledCallback(onFire, 1000));

    act(() => result.current());
    expect(onFire).toHaveBeenCalledTimes(1);

    act(() => result.current());
    expect(onFire).toHaveBeenCalledTimes(1); // still within the interval

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => result.current());
    expect(onFire).toHaveBeenCalledTimes(2);
  });
});

describe('useOnline is testable by toggling a mocked connectivity state', () => {
  it('reacts to mockOnlineStatus(false) and back to true', () => {
    const { result } = renderHookWithProviders(useOnline);

    expect(result.current).toBe(true);

    act(() => mockOnlineStatus(false));
    expect(result.current).toBe(false);

    act(() => mockOnlineStatus(true));
    expect(result.current).toBe(true);
  });

  it('resetOnlineStatus removes the mock entirely, not just resets its value', () => {
    mockOnlineStatus(false);
    expect(Object.getOwnPropertyDescriptor(navigator, 'onLine')).toBeDefined();

    resetOnlineStatus();

    // No own property left on navigator — onLine is back to being
    // inherited from Navigator.prototype, exactly as it was before any
    // test in this file touched it.
    expect(Object.getOwnPropertyDescriptor(navigator, 'onLine')).toBeUndefined();
  });
});
