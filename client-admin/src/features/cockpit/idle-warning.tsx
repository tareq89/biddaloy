import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useEffect, useRef, useState } from 'react';

import { useIdleTimer } from './use-idle-timer';

const SIGN_OUT_WAIT_MS = 5000;
/** While the owner is active, renew the server's idle key at most this often (polls do not). */
export const ACTIVE_RENEW_EVERY_MS = 5 * 60_000;

export interface CockpitIdleWarningProps {
  /** Every string comes in as a prop; #3763 passes the `ownerSecurity` `idle.*` keys. */
  strings: { title: string; body: string; stay: string; signOut: string; expired: string };
  /** A harmless authenticated GET; the server renews its idle key on it. */
  renew: () => Promise<unknown>;
  /** Ends the session. */
  signOut: () => Promise<unknown> | void;
  /** After sign-out: go to `/sign-in`; `notice` is set when the idle limit ended it. */
  onSignedOut: (notice: string | null) => void;
}

/** One-minute warning before the 30-minute idle sign-out. Mounted by #3763. */
export function CockpitIdleWarning({
  strings,
  renew,
  signOut,
  onSignedOut,
}: CockpitIdleWarningProps) {
  const [open, setOpen] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const stayRef = useRef<HTMLButtonElement>(null);
  const leaving = useRef(false);
  const leave = async (notice: string | null) => {
    if (leaving.current) return;
    leaving.current = true;
    setBusy(true);
    setOpen(false);
    try {
      // Bounded: a stalled logout request must not strand the user on the page.
      await Promise.race([
        Promise.resolve(signOut()),
        new Promise((resolve) => setTimeout(resolve, SIGN_OUT_WAIT_MS)),
      ]);
    } catch {
      // Sign-out call failed: still leave; the server idle limit ends the session.
    } finally {
      onSignedOut(notice);
    }
  };
  const lastRenew = useRef(Date.now());
  const trailing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const renewRef = useRef(renew);
  useEffect(() => {
    renewRef.current = renew;
  }, [renew]);
  // A dead session ends via the 401 handler, so a failed keepalive is ignored here.
  const renewNow = () => {
    lastRenew.current = Date.now();
    void Promise.resolve(renewRef.current()).catch(() => undefined);
  };
  useEffect(() => () => clearTimeout(trailing.current), []);
  const { reset } = useIdleTimer({
    onWarn: () => setOpen(true),
    onExpire: () => void leave(strings.expired),
    onResume: () => setOpen(false),
    // The server renews on real requests only, so activity alone must not let it idle out first.
    // Activity inside the throttle window schedules ONE trailing renewal for when it ends, so the
    // server key never expires before the client warning (which counts from the last activity).
    onActive: () => {
      if (leaving.current) return;
      const since = Date.now() - lastRenew.current;
      if (since >= ACTIVE_RENEW_EVERY_MS) {
        clearTimeout(trailing.current);
        trailing.current = undefined;
        renewNow();
      } else if (trailing.current === undefined) {
        trailing.current = setTimeout(() => {
          trailing.current = undefined;
          if (!leaving.current) renewNow();
        }, ACTIVE_RENEW_EVERY_MS - since);
      }
    },
  });
  const stay = async () => {
    setRenewing(true);
    try {
      await renew();
      // A renewal that lands after Sign out began must not revive the timer or reopen anything.
      if (leaving.current) return;
      reset();
      setOpen(false);
    } catch {
      // Renewal failed (session already gone): leave the warning up; expiry signs out.
    } finally {
      setRenewing(false);
    }
  };

  // Only the two buttons close it: Esc and an outside click are ignored, and there is no corner X.
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        size="sm"
        role="alertdialog"
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          stayRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{strings.title}</DialogTitle>
          <DialogDescription>{strings.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => void leave(null)} disabled={busy}>
            {strings.signOut}
          </Button>
          <Button ref={stayRef} onClick={() => void stay()} loading={renewing} disabled={busy}>
            {strings.stay}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
