import { ApiError } from '@biddaloy/ui/api';
import { useCreateSeatOrder, usePayWithBkash } from '@biddaloy/ui/hooks';

import { BuySeatsDialog, type BuySeatsDialogProps } from './BuySeatsDialog';

/**
 * The server closed this order (404, or 409 `ORDER_NOT_PENDING`): only a new order can be paid.
 * The other 409, `PAYMENT_STARTING`, and a 503 leave the order payable: press Pay again. Rotating
 * the key for those would make a second PENDING order on the next submit (a double click).
 */
export function payClosedOrder(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return (
    err.statusCode === 404 ||
    (err.statusCode === 409 && err.details?.['code'] === 'ORDER_NOT_PENDING')
  );
}

/** `BuySeatsDialog` wired to `POST /billing/orders`. Used by Settings and by the seat-limit error. */
export function BuySeatsFlow(
  props: Omit<
    BuySeatsDialogProps,
    'onSubmit' | 'pending' | 'failed' | 'created' | 'onPay' | 'paying' | 'payFailed' | 'payClosed'
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
      payClosed={payClosedOrder(pay.error)}
      onPay={(orderId) =>
        pay.mutate(orderId, {
          onSuccess: (r) => window.location.assign(r.bkash_url),
          // A closed order: back to the form for a new one. Anything else stays on Pay.
          onError: (err) => {
            if (payClosedOrder(err)) create.reset();
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
