/**
 * Read-only view of what the student owes (same shape as `students/
 * -detail/fees-tab.tsx`'s table — [8.10.2]'s AC for that tab), plus the
 * one input this step owns: how much the accountant was actually handed.
 * That amount is what `-allocate-step.tsx` prefills FIFO against.
 */
import { MoneyInput } from '@biddaloy/ui/components';
import type { StudentFeeSummary } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';
import type { UseQueryResult } from '@tanstack/react-query';

import { QueryState } from './query-state';

export interface OutstandingFeesStepProps {
  studentName: string;
  feeSummaryQuery: UseQueryResult<StudentFeeSummary, unknown>;
  totalMinorUnits: number | undefined;
  onTotalChange: (minorUnits: number | undefined) => void;
}

export function OutstandingFeesStep({
  studentName,
  feeSummaryQuery,
  totalMinorUnits,
  onTotalChange,
}: OutstandingFeesStepProps) {
  const { t } = useTranslation('payments');
  const config = useRegionConfig();

  function money(amount: number | string): string {
    return formatServerAmount(amount, config);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t('record.outstandingFees.forStudent', { name: studentName })}
      </p>

      <QueryState
        query={feeSummaryQuery}
        forbiddenMessage={t('record.outstandingFees.forbidden')}
        errorMessage={t('record.outstandingFees.errorMessage')}
      >
        {(feeSummary) =>
          feeSummary.summary.balance <= 0 ? (
            <p className="text-sm text-muted-foreground">{t('record.outstandingFees.noBalance')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm text-muted-foreground">
                  {t('record.outstandingFees.totalDue')}
                </p>
                <p className="text-lg font-semibold">{money(feeSummary.summary.total_due)}</p>
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm text-muted-foreground">
                  {t('record.outstandingFees.totalPaid')}
                </p>
                <p className="text-lg font-semibold">{money(feeSummary.summary.total_paid)}</p>
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm text-muted-foreground">
                  {t('record.outstandingFees.balance')}
                </p>
                <p className="text-lg font-semibold">{money(feeSummary.summary.balance)}</p>
              </div>
            </div>
          )
        }
      </QueryState>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="record-payment-amount" className="text-sm font-medium">
          {t('record.outstandingFees.amountReceivedLabel')}
        </label>
        <MoneyInput
          id="record-payment-amount"
          aria-label={t('record.outstandingFees.amountReceivedLabel')}
          value={totalMinorUnits}
          onValueChange={onTotalChange}
          config={config}
        />
      </div>
    </div>
  );
}
