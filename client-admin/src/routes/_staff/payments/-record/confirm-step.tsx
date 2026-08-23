/**
 * `WizardShell`'s `reviewStep` — required by its own type once
 * `irreversible` is `true` (see `wizard-shell.tsx`'s header comment).
 * Read-only: every value here was already entered on an earlier step,
 * this only summarizes it before the accountant commits.
 */
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';

import { MutationErrorMessage } from '../../../../components/MutationErrorMessage';

import type { AllocationLine } from './allocation-math';
import type { PaymentMethodValue } from './method-step';

export interface ConfirmStepProps {
  studentName: string;
  totalMinorUnits: number;
  lines: readonly AllocationLine[];
  paymentMethod: PaymentMethodValue;
  transactionReference: string;
  generateInvoice: boolean;
  willFullyPay: boolean;
  submitError: unknown;
}

export function ConfirmStep({
  studentName,
  totalMinorUnits,
  lines,
  paymentMethod,
  transactionReference,
  generateInvoice,
  willFullyPay,
  submitError,
}: ConfirmStepProps) {
  const { t } = useTranslation('payments');
  const config = useRegionConfig();
  const touchedLines = lines.filter((line) => line.allocatedMinorUnits > 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        {t('record.confirm.summary', {
          amount: formatCurrency(totalMinorUnits, config),
          name: studentName,
        })}
      </p>

      <ul className="flex flex-col gap-1 text-sm">
        {touchedLines.map((line) => (
          <li key={line.studentFeeId}>
            {t('record.confirm.line', {
              month: line.month,
              year: line.year,
              amount: formatCurrency(line.allocatedMinorUnits, config),
            })}
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted-foreground">
        {t('record.method.methods.' + paymentMethod)}
        {transactionReference.trim() !== '' ? ` · ${transactionReference.trim()}` : ''}
      </p>

      {generateInvoice && willFullyPay && (
        <p className="text-sm text-muted-foreground">{t('record.confirm.invoiceWillGenerate')}</p>
      )}

      {submitError !== undefined && submitError !== null && (
        <MutationErrorMessage error={submitError} />
      )}
    </div>
  );
}
