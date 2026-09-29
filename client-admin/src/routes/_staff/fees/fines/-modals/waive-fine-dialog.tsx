/**
 * [38.4.1] "Waive fine" — full or partial write-off of one fine, gated by
 * `ApprovalScope.FEES_DISCOUNT` (see `useWaiveFine`'s own JSDoc — NOT
 * `Permission.FEE_APPROVE`, which the ticket body names but is the wrong
 * axis). Step-up flow cloned structurally from
 * `client-admin/src/routes/_staff/payments/-reverse-payment-dialog.tsx`.
 *
 * `StudentFee` (the `Fine` type) has no `balance` field — outstanding is
 * computed the same way `fee-dues.service.ts:232` does server-side:
 * `total_amount - paid_amount - discount_amount`.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useFines, useWaiveFine, type Fine } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatCurrency,
  minorUnitsToDecimalString,
  serverAmountToMinorUnits,
} from '@biddaloy/ui/utils';
import * as React from 'react';

const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 500;
const OPEN_STATUSES = new Set(['PENDING', 'PARTIALLY_PAID', 'OVERDUE']);

export interface WaiveFineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fineId?: string;
  studentId?: string;
}

function outstandingOf(fine: Fine): number {
  return fine.total_amount - fine.paid_amount - fine.discount_amount;
}

export function WaiveFineDialog({ open, onOpenChange, fineId, studentId }: WaiveFineDialogProps) {
  const { t } = useTranslation('fines');
  const config = useRegionConfig();

  const [selectedFineId, setSelectedFineId] = React.useState(fineId ?? '');
  const [mode, setMode] = React.useState<'FULL' | 'PARTIAL'>('FULL');
  const [amountMinorUnits, setAmountMinorUnits] = React.useState<number | undefined>(undefined);
  const [reason, setReason] = React.useState('');

  // studentId-only mode (the command palette's entry point) fetches that
  // student's fines; the fineId-given mode (row action on the Fines page)
  // fetches the whole list and picks its one fine out of it — `fines.ts`
  // has no "get one fine" hook, so this is the same data source either
  // way, just used differently below.
  const finesQuery = useFines(studentId !== undefined ? { student_id: studentId } : { limit: 100 });
  const allFines = React.useMemo(() => finesQuery.data?.items ?? [], [finesQuery.data]);
  const openFines = React.useMemo(
    () =>
      studentId !== undefined ? allFines.filter((fine) => OPEN_STATUSES.has(fine.status)) : [],
    [allFines, studentId],
  );

  React.useEffect(() => {
    if (open) {
      setSelectedFineId(fineId ?? '');
      setMode('FULL');
      setAmountMinorUnits(undefined);
      setReason('');
    }
  }, [open, fineId]);

  const selectedFine = allFines.find((fine) => fine.id === (fineId ?? selectedFineId));
  const outstandingMinorUnits =
    selectedFine !== undefined
      ? serverAmountToMinorUnits(outstandingOf(selectedFine), config)
      : undefined;

  const waiveFine = useWaiveFine();

  const trimmedReason = reason.trim();
  const reasonInvalid =
    trimmedReason.length < REASON_MIN_LENGTH || reason.length > REASON_MAX_LENGTH;
  // `outstandingMinorUnits === undefined` (the fine hasn't resolved from
  // `finesQuery` yet, e.g. it fell outside the fetched page in
  // fineId-only mode) fails the partial check closed, not open — never
  // let an unverified amount pass client-side validation.
  const partialAmountInvalid =
    mode === 'PARTIAL' &&
    (amountMinorUnits === undefined ||
      amountMinorUnits <= 0 ||
      outstandingMinorUnits === undefined ||
      amountMinorUnits > outstandingMinorUnits);

  const effectiveFineId = fineId ?? selectedFineId;
  const canSubmit =
    effectiveFineId !== '' && !reasonInvalid && !partialAmountInvalid && !waiveFine.isPending;

  const alreadyPaid = waiveFine.error instanceof ApiError && waiveFine.error.statusCode === 409;

  function handleConfirm() {
    if (!canSubmit) return;
    waiveFine.mutate(
      {
        id: effectiveFineId,
        reason: trimmedReason,
        ...(mode === 'PARTIAL' && amountMinorUnits !== undefined
          ? { amount: Number(minorUnitsToDecimalString(amountMinorUnits, config)) }
          : {}),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('waiveDialog.title')}</DialogTitle>
          <DialogDescription>{t('waiveDialog.reasonPlaceholder')}</DialogDescription>
        </DialogHeader>

        {fineId === undefined && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('columns.fine')}</span>
            <Select value={selectedFineId} onValueChange={setSelectedFineId}>
              <SelectTrigger aria-label={t('columns.fine')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {openFines.map((fine) => (
                  <SelectItem key={fine.id} value={fine.id}>
                    {fine.fee_name} —{' '}
                    {formatCurrency(serverAmountToMinorUnits(outstandingOf(fine), config), config)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as typeof mode)}
          className="flex flex-col gap-2"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="FULL" />
            {t('waiveDialog.fullLabel')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="PARTIAL" />
            {t('waiveDialog.partialLabel')}
          </label>
        </RadioGroup>

        {mode === 'PARTIAL' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="waive-fine-amount" className="text-sm font-medium">
              {t('waiveDialog.amountLabel')}
            </label>
            <MoneyInput
              id="waive-fine-amount"
              aria-label={t('waiveDialog.amountLabel')}
              config={config}
              value={amountMinorUnits}
              onValueChange={setAmountMinorUnits}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="waive-fine-reason" className="text-sm font-medium">
            {t('waiveDialog.reasonLabel')}
          </label>
          <Textarea
            id="waive-fine-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={REASON_MAX_LENGTH}
            rows={3}
          />
        </div>

        {waiveFine.isError && (
          <p role="alert" className="text-sm text-destructive">
            {alreadyPaid ? t('waiveDialog.alreadyPaid') : t('waiveDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={!canSubmit}
            loading={waiveFine.isPending}
            onClick={handleConfirm}
          >
            {waiveFine.isPending ? t('waiveDialog.waiving') : t('waiveDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
