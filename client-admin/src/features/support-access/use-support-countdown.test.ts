import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSupportCountdown } from './use-support-countdown';

const MIN = 60_000;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSupportCountdown', () => {
  it('is null without a deadline and sets no timer', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { result } = renderHook(() => useSupportCountdown(null));
    expect(result.current).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('crosses the 5 and 1 minute marks and ends at 0, one timeout at a time, no interval', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const at = Date.now() + 6 * MIN;
    const { result } = renderHook(() => useSupportCountdown(at));
    expect(result.current).toBe(360);
    act(() => void vi.advanceTimersByTime(MIN));
    expect(result.current).toBe(300);
    act(() => void vi.advanceTimersByTime(4 * MIN));
    expect(result.current).toBe(60);
    act(() => void vi.advanceTimersByTime(MIN));
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(interval).not.toHaveBeenCalled();
  });

  it('jumps to the right value on wake-up after a long sleep', () => {
    const at = Date.now() + 10 * MIN;
    const { result } = renderHook(() => useSupportCountdown(at));
    // The clock jumps with no timer firing (sleeping laptop), then the tab wakes.
    vi.setSystemTime(Date.now() + 11 * MIN);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toBe(0);
  });

  it('uses a single end timeout, not minute ticks, while the tab is hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const at = Date.now() + 10 * MIN;
    const { result } = renderHook(() => useSupportCountdown(at));
    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(10 * MIN));
    expect(result.current).toBe(0);
  });
});
