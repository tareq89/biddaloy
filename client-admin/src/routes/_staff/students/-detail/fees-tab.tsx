import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useStudentFeeSummary } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, parseCurrency } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

export interface FeesTabProps {
  studentId: string;
}

/** [8.10.2]'s AC: "Fees tab shows outstanding, paid balance clearly." */
export function FeesTab({ studentId }: FeesTabProps) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const query = useStudentFeeSummary(studentId);

  // Server decimal columns (`total_amount`, etc.) serialize as plain
  // `"500.00"`-shaped strings, not floats — `parseCurrency` already
  // parses exactly that shape into minor units without re-implementing
  // the conversion here. `summary.*` are pre-summed on the server as
  // JS numbers, but `String(1500.5)` is just as valid an input to it.
  function money(amount: number | string): string {
    return formatCurrency(parseCurrency(String(amount), regionConfig), regionConfig);
  }

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.fees.errorMessage')}
    >
      {(feeSummary) => (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">{t('detail.fees.totalBilled')}</p>
              <p className="text-lg font-semibold">{money(feeSummary.summary.total_due)}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">{t('detail.fees.totalPaid')}</p>
              <p className="text-lg font-semibold">{money(feeSummary.summary.total_paid)}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">{t('detail.fees.outstanding')}</p>
              <p className="text-lg font-semibold">{money(feeSummary.summary.balance)}</p>
            </div>
          </div>
          {feeSummary.fee_breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.fees.emptyMessage')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.fees.columnMonth')}</TableHead>
                  <TableHead>{t('detail.fees.columnAmount')}</TableHead>
                  <TableHead>{t('detail.fees.columnPaid')}</TableHead>
                  <TableHead>{t('detail.fees.columnDiscount')}</TableHead>
                  <TableHead>{t('detail.fees.columnStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeSummary.fee_breakdown.map((fee) => (
                  <TableRow key={fee.id}>
                    <TableCell>
                      {fee.year}-{String(fee.month).padStart(2, '0')}
                    </TableCell>
                    <TableCell>{money(fee.total_amount)}</TableCell>
                    <TableCell>{money(fee.paid_amount)}</TableCell>
                    <TableCell>{money(fee.discount_amount)}</TableCell>
                    <TableCell>{fee.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </TabQueryState>
  );
}
