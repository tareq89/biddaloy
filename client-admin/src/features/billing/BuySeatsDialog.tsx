import { SeatOrderStatus } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@biddaloy/ui/components';
import type { SeatOrderDto } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

import { MAX_MONTHS, MAX_SEATS, orderTotalPaisa, parseWhole } from './billing-math';
import { CouponRow, type AppliedCoupon } from './CouponRow';

export interface BuySeatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seats typed into the box when the dialog opens. */
  initialSeats: number;
  /** The school's price per seat per month, paisa. Unknown (still loading): price and total show a dash. */
  unitPricePaisa?: number | undefined;
  /** Open the coupon row on first render (`?coupon=1`). */
  openCoupon?: boolean | undefined;
  /** The server turned the coupon down on submit (400 COUPON_NOT_VALID). */
  couponRejected?: boolean | undefined;
  /** Open the receipt of a created order (free orders have no bKash step). */
  onReceipt?: (orderId: string) => void;
  receiptFailed?: boolean | undefined;
  /** Shown when opened from the "seat limit reached" error. */
  limitReached?: boolean;
  pending?: boolean;
  failed?: boolean;
  /** The order the server made, once it did. */
  created?: SeatOrderDto | undefined;
  /** Pay the created order with bKash (the caller redirects to bKash). */
  onPay?: (orderId: string) => void;
  paying?: boolean;
  payFailed?: boolean;
  /** The server closed the order (not PENDING / gone): the next submit must use a new key. */
  payClosed?: boolean;
  /** `idempotency_key` is the same for every retry until the dialog is reopened. */
  onSubmit: (input: {
    seats: number;
    months: number;
    coupon_code?: string;
    idempotency_key: string;
  }) => void;
}

export function BuySeatsDialog({
  open,
  onOpenChange,
  initialSeats,
  limitReached,
  pending,
  failed,
  created,
  onPay,
  paying,
  payFailed,
  payClosed,
  unitPricePaisa,
  openCoupon,
  couponRejected,
  onReceipt,
  receiptFailed,
  onSubmit,
}: BuySeatsDialogProps) {
  const { t } = useTranslation('billing');
  const config = useRegionConfig();
  const [seatsText, setSeatsText] = React.useState(String(initialSeats));
  const [monthsText, setMonthsText] = React.useState('1');
  const [touched, setTouched] = React.useState(false);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [applied, setApplied] = React.useState<AppliedCoupon | null>(null);

  // A fresh open: new prefill, new key, no stale errors. Keyed on `open` only, so a background
  // refetch changing `initialSeats` never overwrites what the admin is typing.
  // The server closed the order: the next submit must make a new one, not get it back. Any other
  // pay failure keeps the key, so a retry can never create a second PENDING order.
  React.useEffect(() => {
    if (payClosed) setKey(crypto.randomUUID());
  }, [payClosed]);

  const initialRef = React.useRef(initialSeats);
  initialRef.current = initialSeats;
  React.useEffect(() => {
    if (!open) return;
    setSeatsText(String(initialRef.current));
    setMonthsText('1');
    setTouched(false);
    setApplied(null);
    setKey(crypto.randomUUID());
  }, [open]);

  // A coupon the server refused on submit: back to the plain price and a new key.
  React.useEffect(() => {
    if (couponRejected) {
      setApplied(null);
      setKey(crypto.randomUUID());
    }
  }, [couponRejected]);

  const seats = parseWhole(seatsText, MAX_SEATS);
  const months = parseWhole(monthsText, MAX_MONTHS);
  const listTotal =
    seats !== null && months !== null && unitPricePaisa !== undefined
      ? orderTotalPaisa(seats, months, unitPricePaisa)
      : null;
  // The server's number once a coupon is applied; the list price before.
  const total = applied ? applied.preview.totalPaisa : listTotal;
  const free = applied?.preview.free ?? false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (seats === null || months === null) return;
    onSubmit({
      seats,
      months,
      ...(applied ? { coupon_code: applied.code } : {}),
      idempotency_key: key,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('buy.createdTitle')}</DialogTitle>
              <DialogDescription>
                {t('buy.createdBody', {
                  seats: formatNumber(created.seats, config),
                  months: formatNumber(created.months, config),
                  total: formatCurrency(created.amount_paisa, config),
                })}
              </DialogDescription>
            </DialogHeader>
            {created.status === SeatOrderStatus.PAID && (
              <p className="text-sm">{t('coupon.freeDone')}</p>
            )}
            {payFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t('buy.payFailed')}
              </p>
            )}
            {receiptFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t('orders.receiptFailed')}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('buy.close')}
              </Button>
              {created.status === SeatOrderStatus.PAID && onReceipt && (
                <Button onClick={() => onReceipt(created.id)}>{t('coupon.receipt')}</Button>
              )}
              {created.status !== SeatOrderStatus.PAID && onPay && (
                <Button loading={paying ?? false} onClick={() => onPay(created.id)}>
                  {t('buy.payBkash')}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <form noValidate onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('buy.title')}</DialogTitle>
              <DialogDescription>
                {limitReached ? t('buy.limitIntro') : t('buy.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="buy-seats">{t('buy.seats')}</Label>
              <Input
                id="buy-seats"
                inputMode="numeric"
                value={seatsText}
                onChange={(e) => {
                  setSeatsText(e.target.value);
                  // New values must not ride on an old key: the server would return the first order.
                  setKey(crypto.randomUUID());
                }}
                aria-invalid={touched && seats === null}
                aria-describedby={touched && seats === null ? 'buy-seats-error' : undefined}
              />
              {touched && seats === null && (
                <p id="buy-seats-error" role="alert" className="text-sm text-destructive">
                  {t('buy.seatsError', { max: formatNumber(MAX_SEATS, config) })}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="buy-months">{t('buy.months')}</Label>
              <Input
                id="buy-months"
                inputMode="numeric"
                value={monthsText}
                onChange={(e) => {
                  setMonthsText(e.target.value);
                  setKey(crypto.randomUUID());
                }}
                aria-invalid={touched && months === null}
                aria-describedby={touched && months === null ? 'buy-months-error' : undefined}
              />
              {touched && months === null && (
                <p id="buy-months-error" role="alert" className="text-sm text-destructive">
                  {t('buy.monthsError', { max: formatNumber(MAX_MONTHS, config) })}
                </p>
              )}
            </div>
            <CouponRow
              seats={seats}
              months={months}
              rejected={couponRejected}
              defaultOpen={openCoupon}
              onApplied={(next) => {
                setApplied(next);
                // The body changed (code added or dropped): it must not ride on an old key.
                setKey(crypto.randomUUID());
              }}
            />
            <div className="rounded-md bg-muted p-3" aria-live="polite">
              <p className="text-caption text-text-secondary">
                {unitPricePaisa === undefined
                  ? '—'
                  : t('buy.price', { price: formatCurrency(unitPricePaisa, config) })}
              </p>
              {applied && (
                <>
                  <p className="text-caption tabular-nums">
                    {t('coupon.list')}: {formatCurrency(applied.preview.listAmountPaisa, config)}
                  </p>
                  <p className="text-caption tabular-nums">
                    {t('coupon.discount')}: −{formatCurrency(applied.preview.discountPaisa, config)}
                  </p>
                </>
              )}
              <p className="text-h2 tabular-nums">
                {applied ? t('coupon.newTotal') : t('buy.total')}:{' '}
                {total === null ? '—' : formatCurrency(total, config)}
              </p>
              {seats !== null && months !== null && (
                <p className="text-caption text-text-secondary">
                  {t('buy.totalLine', {
                    seats: formatNumber(seats, config),
                    months: formatNumber(months, config),
                  })}
                </p>
              )}
            </div>
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                {t('buy.createFailed')}
              </p>
            )}
            {payFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t('buy.payFailed')}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('buy.cancel')}
              </Button>
              <Button type="submit" loading={pending ?? false}>
                {free ? t('coupon.submitFree') : t('buy.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
