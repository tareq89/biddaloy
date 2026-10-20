import { ApiError } from '@biddaloy/ui/api';
import { useCreateSeatOrder, usePayWithBkash } from '@biddaloy/ui/hooks';

import { BuySeatsDialog, type BuySeatsDialogProps } from './BuySeatsDialog';

/** `BuySeatsDialog` wired to `POST /billing/orders`. Used by Settings and by the seat-limit error. */
export function BuySeatsFlow(
  props: Omit<
    BuySeatsDialogProps,
    'onSubmit' | 'pending' | 'failed' | 'created' | 'onPay' | 'paying' | 'payFailed'
  >,
) {
  const create = useCreateSeatOrder();
  const pay = usePayWithBkash();
  return (
    <BuySeatsDialog
      {...props}
      onOpenChange={(open) => {
        if (!open) {
          create.reset();
          pay.reset();
        }
        props.onOpenChange(open);
      }}
      pending={create.isPending}
      failed={create.isError}
      created={create.data}
      paying={pay.isPending || pay.isSuccess}
      payFailed={pay.isError}
      onPay={(orderId) =>
        pay.mutate(orderId, {
          onSuccess: (r) => window.location.assign(r.bkash_url),
          // The server closed or refused the order (404/409/503): back to the form for a new one.
          onError: (err) => {
            if (err instanceof ApiError && [404, 409, 503].includes(err.statusCode)) create.reset();
          },
        })
      }
      onSubmit={(input) => {
        pay.reset();
        create.mutate(input);
      }}
    />
  );
}
