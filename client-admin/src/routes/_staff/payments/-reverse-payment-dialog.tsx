/**
 * [16.6.2] "Reverse payment" confirm dialog off `$id.tsx`'s detail page.
 * `POST /payments/:id/reverse` is hand-typed (`useReversePayment` in
 * `ui/src/hooks/payments.ts`) ahead of #670's server work — see the plan
 * comment on #672. D9's step-up approval (`ApprovalScope.PAYMENTS_REVERSE`)
 * is handled by `useApprovedMutation` itself; this component only needs to
 * render its `modal` output, same as `remove-student-dialog.tsx`.
 *
 * **Mount only while `open` is true** (`{reverseOpen && <ReversePaymentDialog
 * ... />}`, as `$id.tsx` already does) — same reasoning `remove-student-
 * dialog.tsx`'s own comment gives: `useApprovedMutation`'s single modal
 * host goes to whichever instance mounts first and keeps it forever, so an
 * always-mounted instance here would starve any other approved mutation on
 * the page.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@biddaloy/ui/components';
import { type ReverseLaterPaymentsFirstDetails, useReversePayment } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 500;

export interface ReversePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
}

export function ReversePaymentDialog({ open, onOpenChange, paymentId }: ReversePaymentDialogProps) {
  const { t } = useTranslation('payments');
  const reversePayment = useReversePayment();
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) {
      reversePayment.reset();
      setReason('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const trimmedReason = reason.trim();
  const reasonInvalid =
    trimmedReason.length < REASON_MIN_LENGTH || reason.length > REASON_MAX_LENGTH;

  const blockingPaymentIds =
    reversePayment.error instanceof ApiError && reversePayment.error.statusCode === 409
      ? (reversePayment.error.details as ReverseLaterPaymentsFirstDetails | undefined)?.payment_ids
      : undefined;

  function handleConfirm() {
    if (reasonInvalid) return;
    reversePayment.mutate(
      { paymentId, reason: trimmedReason },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('detail.reverseDialog.title')}</DialogTitle>
            <DialogDescription>{t('detail.reverseDialog.description')}</DialogDescription>
          </DialogHeader>

          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>{t('detail.reverseDialog.consequenceWallet')}</li>
            <li>{t('detail.reverseDialog.consequenceCreditNote')}</li>
            <li>{t('detail.reverseDialog.consequenceIrreversible')}</li>
          </ul>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="reverse-payment-reason" className="text-sm font-medium">
              {t('detail.reverseDialog.reasonLabel')}
            </label>
            <Textarea
              id="reverse-payment-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
            />
          </div>

          {reversePayment.isError &&
            (blockingPaymentIds !== undefined ? (
              <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
                <span>{t('detail.reverseDialog.errorLaterPayments')}</span>
                <ul className="list-disc pl-5">
                  {blockingPaymentIds.map((id) => (
                    <li key={id}>
                      <Link to="/payments/$id" params={{ id }} className="underline">
                        {id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p role="alert" className="text-sm text-destructive">
                {t('detail.reverseDialog.errorMessage')}
              </p>
            ))}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={reasonInvalid}
              loading={reversePayment.isPending}
              onClick={handleConfirm}
            >
              {t('detail.reverseDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {reversePayment.modal}
    </>
  );
}
