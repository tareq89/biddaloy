import { ApiError } from '@biddaloy/ui/api';
import {
  openBillingReceipt,
  useBillingSummary,
  useCreateSeatOrder,
  usePayWithBkash,
} from '@biddaloy/ui/hooks';
import * as React from 'react';

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

/** 400 `COUPON_NOT_VALID`: the server refused the coupon on submit. */
export function couponNotValid(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.statusCode === 400 &&
    err.details?.['code'] === 'COUPON_NOT_VALID'
  );
}

/** `BuySeatsDialog` wired to `POST /billing/orders`. Used by Settings and by the seat-limit error. */
export function BuySeatsFlow(
  props: Omit<
    BuySeatsDialogProps,
    | 'onSubmit'
    | 'pending'
    | 'failed'
    | 'created'
    | 'onPay'
    | 'paying'
    | 'payFailed'
    | 'payClosed'
    | 'couponRejected'
    | 'onReceipt'
    | 'receiptFailed'
  >,
) {
  const create = useCreateSeatOrder();
  const pay = usePayWithBkash();
  const summary = useBillingSummary();
  const [receiptFailed, setReceiptFailed] = React.useState(false);
  const rejected = couponNotValid(create.error);
  return (
    <BuySeatsDialog
      {...props}
      unitPricePaisa={props.unitPricePaisa ?? summary.data?.unit_price_paisa}
      onOpenChange={(open) => {
        if (!open) {
          create.reset();
          pay.reset();
          setReceiptFailed(false);
        }
        props.onOpenChange(open);
      }}
      pending={create.isPending}
      failed={create.isError && !rejected}
      couponRejected={rejected}
      receiptFailed={receiptFailed}
      onReceipt={(id) => {
        setReceiptFailed(false);
        openBillingReceipt(id).catch(() => setReceiptFailed(true));
      }}
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
