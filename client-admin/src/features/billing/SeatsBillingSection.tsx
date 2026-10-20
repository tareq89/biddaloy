import { useBillingSummary } from '@biddaloy/ui/hooks';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { defaultSeats } from './billing-math';
import { BuySeatsFlow } from './BuySeatsFlow';
import { SeatsBillingSectionView } from './SeatsBillingSectionView';

const POLL_LIMIT_MS = 2 * 60 * 1000;

/** Settings › Seats & billing (Epic 49 D7). Entitlement comes from the summary, never `schools.seat_limit`. */
export function SeatsBillingSection({
  openBuy = false,
  returnOrderId,
  payment,
}: {
  openBuy?: boolean;
  /** The order bKash sent the admin back for; its status is polled and shown. */
  returnOrderId?: string | undefined;
  /** bKash's own word on how the return went; anything but success stops the polling. */
  payment?: 'success' | 'cancel' | 'failure' | 'error' | undefined;
}) {
  // Poll only while bKash may still be confirming, and give up after 2 minutes.
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    setTimedOut(false);
    if (!returnOrderId) return;
    const id = window.setTimeout(() => setTimedOut(true), POLL_LIMIT_MS);
    return () => window.clearTimeout(id);
  }, [returnOrderId]);
  const polling = !timedOut && (payment === undefined || payment === 'success');
  const query = useBillingSummary(polling ? returnOrderId : undefined);
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(openBuy);
  // The palette's "Buy seats" lands here with `?buy=1` after this section may already be mounted.
  React.useEffect(() => {
    if (openBuy) setOpen(true);
  }, [openBuy]);

  return (
    <>
      <SeatsBillingSectionView
        summary={query.data}
        loading={query.isLoading}
        error={query.isError}
        returnOrderId={returnOrderId}
        payment={payment}
        pollTimedOut={timedOut}
        onBuy={() => setOpen(true)}
        onRetry={() => void query.refetch()}
      />
      <BuySeatsFlow
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Drop `?buy=1` so a re-render or back-navigation does not reopen the dialog.
          if (!next && openBuy) {
            void navigate({ to: '/settings', search: { section: 'billing' }, replace: true });
          }
        }}
        initialSeats={
          query.data ? defaultSeats(query.data.seats_used, query.data.seats_bought) : 100
        }
      />
    </>
  );
}
