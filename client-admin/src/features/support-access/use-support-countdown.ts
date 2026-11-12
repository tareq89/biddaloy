import { useEffect, useState } from 'react';

const MINUTE = 60_000;

/**
 * [99.G4.02] Whole seconds left until `expiresAt` (ms), or null with no deadline.
 * No interval: one chained timeout aims at the next minute boundary (the banner
 * shows whole minutes, and the 5 and 1 minute warnings are minute boundaries
 * too). A hidden tab sets a single timeout for the end only, and a wake-up
 * (`visibilitychange`) re-reads the clock, so a sleeping laptop jumps straight
 * to the right value, including 0.
 */
export function useSupportCountdown(expiresAt: number | null): number | null {
  const read = () =>
    expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  const [remaining, setRemaining] = useState(read);

  useEffect(() => {
    if (expiresAt === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      const ms = expiresAt - Date.now();
      setRemaining(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0) return;
      const hidden = document.visibilityState === 'hidden';
      timer = setTimeout(tick, hidden ? ms : ((ms - 1) % MINUTE) + 1);
    };
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [expiresAt]);

  return remaining;
}
