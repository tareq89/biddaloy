import { useBillingSummary } from '@biddaloy/ui/hooks';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { defaultSeats } from './billing-math';
import { BuySeatsFlow } from './BuySeatsFlow';
import { SeatsBillingSectionView } from './SeatsBillingSectionView';

/** Settings › Seats & billing (Epic 49 D7). Entitlement comes from the summary, never `schools.seat_limit`. */
export function SeatsBillingSection({ openBuy = false }: { openBuy?: boolean }) {
  const query = useBillingSummary();
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
