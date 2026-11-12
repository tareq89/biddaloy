import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHARED_ACTIVITY_KEY, useIdleTimer } from './use-idle-timer';

const MIN = 60_000;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function setup() {
  const onWarn = vi.fn();
  const onExpire = vi.fn();
  const hook = renderHook(() => useIdleTimer({ onWarn, onExpire }));
  return { onWarn, onExpire, ...hook };
}

describe('useIdleTimer', () => {
  it('does not expire while another tab is active, and clears a warning it raised', () => {
    const onWarn = vi.fn();
    const onExpire = vi.fn();
    const onResume = vi.fn();
    renderHook(() => useIdleTimer({ onWarn, onExpire, onResume }));
    act(() => {
      vi.advanceTimersByTime(29 * MIN);
    });
    expect(onWarn).toHaveBeenCalledTimes(1);
    // Another tab reports activity now.
    act(() => {
      localStorage.setItem(SHARED_ACTIVITY_KEY, String(Date.now()));
      window.dispatchEvent(new StorageEvent('storage', { key: SHARED_ACTIVITY_KEY }));
    });
    expect(onResume).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

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

  it('visibilitychange while hidden fires nothing', () => {
    const { onExpire } = setup();
    vi.setSystemTime(Date.now() + 120 * MIN);
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(onExpire).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('scroll and wheel count as activity', () => {
    const { onWarn } = setup();
    act(() => {
      vi.advanceTimersByTime(20 * MIN);
    });
    act(() => void window.dispatchEvent(new Event('wheel')));
    act(() => {
      vi.advanceTimersByTime(20 * MIN);
    });
    act(() => void window.dispatchEvent(new Event('scroll')));
    act(() => {
      vi.advanceTimersByTime(20 * MIN);
    });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('unmount clears timer and listeners; a late reset cannot re-arm', () => {
    const { onWarn, onExpire, result, unmount } = setup();
    unmount();
    act(() => {
      result.current.reset();
    });
    act(() => {
      vi.advanceTimersByTime(60 * MIN);
    });
    window.dispatchEvent(new Event('keydown'));
    expect(onWarn).not.toHaveBeenCalled();
    expect(onExpire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enabled=false stops tracking', () => {
    const onWarn = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useIdleTimer({ onWarn, onExpire: vi.fn(), enabled }),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    act(() => {
      vi.advanceTimersByTime(60 * MIN);
    });
    expect(onWarn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('activity after a sleep past the limit expires instead of resetting the clock', () => {
    const { onExpire } = setup();
    act(() => {
      // Device slept: the clock jumped, no timer fired yet.
      vi.setSystemTime(Date.now() + 31 * MIN);
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
