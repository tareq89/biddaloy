import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MIN_BUY_SEATS } from './billing-math';
import { BuySeatsFlow } from './BuySeatsFlow';

/**
 * "Buy seats" beside a `SEAT_LIMIT_REACHED` error: opens the buy dialog prefilled with the
 * shortfall (at least 100). Rendered only for people who hold SETTINGS_MANAGE.
 */
export function SeatLimitReachedAction({ shortfall }: { shortfall: number }) {
  const { t } = useTranslation('billing');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() => setOpen(true)}
      >
        {t('buy.action')}
      </Button>
      <BuySeatsFlow
        open={open}
        onOpenChange={setOpen}
        initialSeats={Math.max(shortfall, MIN_BUY_SEATS)}
        limitReached
      />
    </>
  );
}
