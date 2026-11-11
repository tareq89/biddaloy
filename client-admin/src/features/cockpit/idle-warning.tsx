import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useState } from 'react';

import { useIdleTimer } from './use-idle-timer';

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
  const [busy, setBusy] = useState(false);
  const leave = async (notice: string | null) => {
    setOpen(false);
    try {
      await signOut();
    } finally {
      onSignedOut(notice);
    }
  };
  const { reset } = useIdleTimer({
    onWarn: () => setOpen(true),
    onExpire: () => void leave(strings.expired),
  });
  const stay = async () => {
    setBusy(true);
    try {
      await renew();
      reset();
      setOpen(false);
    } catch {
      // Renewal failed (session already gone): leave the warning up; expiry signs out.
    } finally {
      setBusy(false);
    }
  };

  // Only the two buttons close it: Esc and an outside click are ignored, and there is no corner X.
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent size="sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{strings.title}</DialogTitle>
          <DialogDescription>{strings.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => void leave(null)} disabled={busy}>
            {strings.signOut}
          </Button>
          <Button onClick={() => void stay()} loading={busy}>
            {strings.stay}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
