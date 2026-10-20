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

import {
  MAX_MONTHS,
  MAX_SEATS,
  SEAT_UNIT_PRICE_PAISA,
  orderTotalPaisa,
  parseWhole,
} from './billing-math';

export interface BuySeatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seats typed into the box when the dialog opens. */
  initialSeats: number;
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
  /** `idempotency_key` is the same for every retry until the dialog is reopened. */
  onSubmit: (input: { seats: number; months: number; idempotency_key: string }) => void;
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
  onSubmit,
}: BuySeatsDialogProps) {
  const { t } = useTranslation('billing');
  const config = useRegionConfig();
  const [seatsText, setSeatsText] = React.useState(String(initialSeats));
  const [monthsText, setMonthsText] = React.useState('1');
  const [touched, setTouched] = React.useState(false);
  const [key, setKey] = React.useState(() => crypto.randomUUID());

  // A fresh open: new prefill, new key, no stale errors. Keyed on `open` only, so a background
  // refetch changing `initialSeats` never overwrites what the admin is typing.
  // A refused payment may have closed the order: the next submit must make a new one, not get it back.
  React.useEffect(() => {
    if (payFailed) setKey(crypto.randomUUID());
  }, [payFailed]);

  const initialRef = React.useRef(initialSeats);
  initialRef.current = initialSeats;
  React.useEffect(() => {
    if (!open) return;
    setSeatsText(String(initialRef.current));
    setMonthsText('1');
    setTouched(false);
    setKey(crypto.randomUUID());
  }, [open]);

  const seats = parseWhole(seatsText, MAX_SEATS);
  const months = parseWhole(monthsText, MAX_MONTHS);
  const total = seats !== null && months !== null ? orderTotalPaisa(seats, months) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (seats === null || months === null) return;
    onSubmit({ seats, months, idempotency_key: key });
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
            {payFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t('buy.payFailed')}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('buy.close')}
              </Button>
              {onPay && (
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
            <div className="rounded-md bg-muted p-3" aria-live="polite">
              <p className="text-caption text-text-secondary">
                {t('buy.price', { price: formatCurrency(SEAT_UNIT_PRICE_PAISA, config) })}
              </p>
              <p className="text-h2 tabular-nums">
                {t('buy.total')}: {total === null ? '—' : formatCurrency(total, config)}
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
                {t('buy.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
