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

/** Last activity in any cockpit tab, so an idle tab never signs out an owner working in another
 * (the logout request uses the one shared session cookie). `localStorage` is shared across tabs and
 * fires `storage` events; where it throws (private mode), each tab just uses its own clock. */
export const SHARED_ACTIVITY_KEY = 'biddaloy:cockpit-last-activity';

function readShared(): number {
  try {
    return Number(localStorage.getItem(SHARED_ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(at: number): void {
  try {
    localStorage.setItem(SHARED_ACTIVITY_KEY, String(at));
  } catch {
    // Storage blocked: single-tab behaviour.
  }
}

export interface IdleTimerOptions {
  onWarn: () => void;
  onExpire: () => void;
  /** Another tab was active after this one warned: the warning no longer applies. */
  onResume?: () => void;
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
export function useIdleTimer({ onWarn, onExpire, onResume, enabled = true }: IdleTimerOptions): {
  reset: () => void;
} {
  const last = useRef(Date.now());
  const warned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = useRef(false);
  const check = useRef<() => void>(() => undefined);
  const handlers = useRef({ onWarn, onExpire, onResume });
  handlers.current = { onWarn, onExpire, onResume };

  useEffect(() => {
    active.current = enabled;
    if (!enabled) return undefined;
    let expired = false;
    check.current = () => {
      clearTimeout(timer.current);
      if (expired || !active.current) return;
      const shared = readShared();
      if (shared > last.current) {
        last.current = shared;
        if (warned.current) {
          warned.current = false;
          handlers.current.onResume?.();
        }
      }
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
      if (warned.current) return;
      const now = Date.now();
      // At most one write a second: pointermove fires constantly.
      if (now - last.current >= 1000) writeShared(now);
      last.current = now;
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHARED_ACTIVITY_KEY) check.current();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check.current();
    };
    last.current = Date.now();
    writeShared(last.current);
    warned.current = false;
    check.current();
    window.addEventListener('storage', onStorage);
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  const reset = useCallback(() => {
    if (!active.current) return;
    last.current = Date.now();
    writeShared(last.current);
    warned.current = false;
    check.current();
  }, []);
  return { reset };
}
