/**
 * [68.0 / #2279] MON-08 "Write off" — full or partial write-off of one open bill (any fee type),
 * step-up approved via `useWaiveBill`. Structure cloned from `waive-fine-dialog.tsx`.
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
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from '@biddaloy/ui/components';
import { useWaiveBill, type StudentFee } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatMonth,
  formatServerAmount,
  minorUnitsToDecimalString,
  parseServerDate,
  serverAmountToMinorUnits,
} from '@biddaloy/ui/utils';
import * as React from 'react';

const REASON_MIN_LENGTH = 3;
// Server `WaiveFineDto.reason` is @MaxLength(280).
const REASON_MAX_LENGTH = 280;

export interface WriteOffBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: StudentFee;
}

export function WriteOffBillDialog({ open, onOpenChange, bill }: WriteOffBillDialogProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const waiveBill = useWaiveBill();

  const [mode, setMode] = React.useState<'FULL' | 'PARTIAL'>('FULL');
  const [amountMinorUnits, setAmountMinorUnits] = React.useState<number | undefined>(undefined);
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) {
      waiveBill.reset();
      setMode('FULL');
      setAmountMinorUnits(undefined);
      setReason('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens or its bill changes
  }, [open, bill.id]);

  // `Number()` first: Postgres decimals arrive as strings (see fees-tab.tsx).
  const balance =
    Number(bill.total_amount) - Number(bill.paid_amount) - Number(bill.discount_amount);
  const balanceMinorUnits = serverAmountToMinorUnits(balance, config);

  const trimmedReason = reason.trim();
  const reasonInvalid =
    trimmedReason.length < REASON_MIN_LENGTH || reason.length > REASON_MAX_LENGTH;
  const partialAmountInvalid =
    mode === 'PARTIAL' &&
    (amountMinorUnits === undefined ||
      amountMinorUnits <= 0 ||
      amountMinorUnits > balanceMinorUnits);
  const canSubmit = !reasonInvalid && !partialAmountInvalid && !waiveBill.isPending;
  const alreadySettled = waiveBill.error instanceof ApiError && waiveBill.error.statusCode === 409;

  function handleConfirm() {
    if (!canSubmit) return;
    waiveBill.mutate(
      {
        id: bill.id,
        reason: trimmedReason,
        ...(mode === 'PARTIAL' && amountMinorUnits !== undefined
          ? { amount: Number(minorUnitsToDecimalString(amountMinorUnits, config)) }
          : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !waiveBill.isPending && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('detail.fees.writeOff.title')}</DialogTitle>
          <DialogDescription>{t('detail.fees.writeOff.description')}</DialogDescription>
        </DialogHeader>

        <p className="text-sm font-medium">
          {t('detail.fees.writeOff.billLine', {
            name: bill.fee_structure.name,
            period: formatMonth(parseServerDate(bill.period_start), config),
            balance: formatServerAmount(balance, config),
          })}
        </p>

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as typeof mode)}
          className="flex flex-col gap-2"
        >
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
            <RadioGroupItem value="FULL" />
            {t('detail.fees.writeOff.fullLabel')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
            <RadioGroupItem value="PARTIAL" />
            {t('detail.fees.writeOff.partialLabel')}
          </label>
        </RadioGroup>

        {mode === 'PARTIAL' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="write-off-amount" className="text-sm font-medium">
              {t('detail.fees.writeOff.amountLabel')}
            </label>
            <MoneyInput
              id="write-off-amount"
              config={config}
              value={amountMinorUnits}
              onValueChange={setAmountMinorUnits}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="write-off-reason" className="text-sm font-medium">
            {t('detail.fees.writeOff.reasonLabel')}
          </label>
          <Textarea
            id="write-off-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={REASON_MAX_LENGTH}
            rows={3}
          />
        </div>

        {waiveBill.isError && (
          <p role="alert" className="text-sm text-destructive">
            {alreadySettled
              ? t('detail.fees.writeOff.alreadySettled')
              : t('detail.fees.writeOff.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={waiveBill.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!canSubmit}
            loading={waiveBill.isPending}
            onClick={handleConfirm}
          >
            {waiveBill.isPending
              ? t('detail.fees.writeOff.working')
              : t('detail.fees.writeOff.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
