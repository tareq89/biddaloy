/**
 * [68.0 / #2279] MON-09 "Pay out" — hand the wallet balance (or part of it) back to the family,
 * step-up approved via `useWalletPayout`. Amount is prefilled with the full balance and capped.
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
  MoneyInput,
  Textarea,
} from '@biddaloy/ui/components';
import { useWalletPayout } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatServerAmount,
  minorUnitsToDecimalString,
  serverAmountToMinorUnits,
} from '@biddaloy/ui/utils';
import * as React from 'react';

const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 500;

export interface WalletPayoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  /** Wallet balance in server units (taka). */
  balance: number | string;
}

export function WalletPayoutDialog({
  open,
  onOpenChange,
  studentId,
  balance,
}: WalletPayoutDialogProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const payout = useWalletPayout();

  const balanceMinorUnits = serverAmountToMinorUnits(Number(balance), config);
  const [amountMinorUnits, setAmountMinorUnits] = React.useState<number | undefined>(
    balanceMinorUnits,
  );
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) {
      payout.reset();
      setAmountMinorUnits(balanceMinorUnits);
      setReason('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const trimmedReason = reason.trim();
  const reasonInvalid =
    trimmedReason.length < REASON_MIN_LENGTH || reason.length > REASON_MAX_LENGTH;
  const amountInvalid =
    amountMinorUnits === undefined || amountMinorUnits <= 0 || amountMinorUnits > balanceMinorUnits;
  const canSubmit = !reasonInvalid && !amountInvalid && !payout.isPending;

  // The server's 409 body carries `details.balance` (WALLET_PAYOUT_EXCEEDS_BALANCE; the top-level
  // `code` is not forwarded by the error filter, and this route's only 409 is that one).
  const error = payout.error;
  const serverBalance =
    error instanceof ApiError &&
    error.statusCode === 409 &&
    typeof error.details?.['balance'] === 'number'
      ? error.details['balance']
      : undefined;

  function handleConfirm() {
    if (!canSubmit || amountMinorUnits === undefined) return;
    payout.mutate(
      {
        studentId,
        amount: Number(minorUnitsToDecimalString(amountMinorUnits, config)),
        reason: trimmedReason,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !payout.isPending && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('detail.fees.payout.title')}</DialogTitle>
          <DialogDescription>{t('detail.fees.payout.description')}</DialogDescription>
        </DialogHeader>

        <p className="text-sm font-medium tabular-nums">
          {t('detail.fees.payout.balanceLine', { balance: formatServerAmount(balance, config) })}
        </p>
        <p className="text-sm text-text-secondary">{t('detail.fees.payout.warning')}</p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="wallet-payout-amount" className="text-sm font-medium">
            {t('detail.fees.payout.amountLabel')}
          </label>
          <MoneyInput
            id="wallet-payout-amount"
            config={config}
            value={amountMinorUnits}
            onValueChange={setAmountMinorUnits}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="wallet-payout-reason" className="text-sm font-medium">
            {t('detail.fees.payout.reasonLabel')}
          </label>
          <Textarea
            id="wallet-payout-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={REASON_MAX_LENGTH}
            rows={3}
          />
        </div>

        {payout.isError && (
          <p role="alert" className="text-sm text-destructive">
            {serverBalance !== undefined
              ? t('detail.fees.payout.exceedsBalance', {
                  balance: formatServerAmount(serverBalance, config),
                })
              : t('detail.fees.payout.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={payout.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!canSubmit}
            loading={payout.isPending}
            onClick={handleConfirm}
          >
            {payout.isPending ? t('detail.fees.payout.working') : t('detail.fees.payout.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
