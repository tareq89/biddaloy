import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIdleTimer } from './use-idle-timer';

const MIN = 60_000;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const onWarn = vi.fn();
  const onExpire = vi.fn();
  const hook = renderHook(() => useIdleTimer({ onWarn, onExpire }));
  return { onWarn, onExpire, ...hook };
}

describe('useIdleTimer', () => {
  it('warns at 29 minutes and expires at 30', () => {
    const { onWarn, onExpire } = setup();
    act(() => {
      vi.advanceTimersByTime(29 * MIN - 1);
    });
    expect(onWarn).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('activity before the warning resets the clock', () => {
    const { onWarn } = setup();
    act(() => {
      vi.advanceTimersByTime(20 * MIN);
    });
    act(() => void window.dispatchEvent(new Event('keydown')));
    act(() => {
      vi.advanceTimersByTime(20 * MIN);
    });
    expect(onWarn).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(9 * MIN);
    });
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it('activity after the warning does not cancel it; reset does', () => {
    const { onExpire, result } = setup();
    act(() => {
      vi.advanceTimersByTime(29 * MIN);
    });
    act(() => void window.dispatchEvent(new Event('pointermove')));
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.reset();
    });
    act(() => {
      vi.advanceTimersByTime(29 * MIN);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a wake-from-sleep jump goes straight to expiry, once', () => {
    const { onWarn, onExpire } = setup();
    // The laptop slept: the clock jumps 2 h with no timer firing, then the tab becomes visible.
    vi.setSystemTime(Date.now() + 120 * MIN);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onWarn).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60 * MIN);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
