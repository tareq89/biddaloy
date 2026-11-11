import { useCallback, useEffect, useRef } from 'react';

export const IDLE_WARN_MS = 29 * 60_000;
export const IDLE_EXPIRE_MS = 30 * 60_000;
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
] as const;

export interface IdleTimerOptions {
  onWarn: () => void;
  onExpire: () => void;
  /** Stop tracking (e.g. signed out). */
  enabled?: boolean;
}

/**
 * Fires `onWarn` after 29 minutes without activity and `onExpire` after 30
 * (the server idle limit, #3741). It stores a timestamp and sets one timeout to
 * the next threshold, so there is no ticking interval; a sleeping laptop or a
 * throttled background tab re-checks on wake (`visibilitychange`) and jumps
 * straight to the right state. Once warned, plain activity no longer resets:
 * only the returned `reset` (the "Stay signed in" call) does, because the
 * server renews its idle key on authenticated requests, not on mouse moves.
 * Client activity is therefore not the server's clock: #3763 must handle a 401
 * globally (sign out + redirect) for a session the server ended first.
 */
export function useIdleTimer({ onWarn, onExpire, enabled = true }: IdleTimerOptions): {
  reset: () => void;
} {
  const last = useRef(Date.now());
  const warned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = useRef(false);
  const check = useRef<() => void>(() => undefined);
  const handlers = useRef({ onWarn, onExpire });
  handlers.current = { onWarn, onExpire };

  useEffect(() => {
    active.current = enabled;
    if (!enabled) return undefined;
    let expired = false;
    check.current = () => {
      clearTimeout(timer.current);
      if (expired || !active.current) return;
      const idle = Date.now() - last.current;
      if (idle >= IDLE_EXPIRE_MS) {
        expired = true;
        handlers.current.onExpire();
        return;
      }
      if (idle >= IDLE_WARN_MS && !warned.current) {
        warned.current = true;
        handlers.current.onWarn();
      }
      const next = idle >= IDLE_WARN_MS ? IDLE_EXPIRE_MS : IDLE_WARN_MS;
      timer.current = setTimeout(check.current, next - idle);
    };
    const onActivity = () => {
      if (!warned.current) last.current = Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check.current();
    };
    last.current = Date.now();
    warned.current = false;
    check.current();
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  const reset = useCallback(() => {
    if (!active.current) return;
    last.current = Date.now();
    warned.current = false;
    check.current();
  }, []);
  return { reset };
}
