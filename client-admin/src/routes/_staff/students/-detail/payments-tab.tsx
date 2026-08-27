import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { usePaymentsByStudent } from '@biddaloy/ui/hooks';
import type { FamilyPayment, Payment } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, parseCurrency } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

/** `usePaymentsByStudent` returns `(Payment | FamilyPayment)[]` — the
 * endpoint answers a PARENT/STUDENT with reduced rows that carry no
 * `received_by` at all ([5.1]). This tab only ever runs for staff, who
 * always get the full row, but the union has to be narrowed rather than
 * assumed: the alternative is a cast that would go quietly wrong the day
 * a family-facing screen reuses this component. */
function receivedByName(payment: Payment | FamilyPayment): string | undefined {
  return 'received_by' in payment ? payment.received_by?.full_name : undefined;
}

export interface PaymentsTabProps {
  studentId: string;
}

export function PaymentsTab({ studentId }: PaymentsTabProps) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const query = usePaymentsByStudent(studentId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.payments.errorMessage')}
    >
      {(payments) =>
        payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.payments.emptyMessage')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.payments.columnDate')}</TableHead>
                <TableHead>{t('detail.payments.columnAmount')}</TableHead>
                <TableHead>{t('detail.payments.columnMethod')}</TableHead>
                <TableHead>{t('detail.payments.columnReference')}</TableHead>
                <TableHead>{t('detail.payments.columnReceivedBy')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{payment.payment_date}</TableCell>
                  <TableCell>
                    {formatCurrency(
                      parseCurrency(String(payment.total_amount), regionConfig),
                      regionConfig,
                    )}
                  </TableCell>
                  <TableCell>{payment.payment_method}</TableCell>
                  <TableCell>{payment.transaction_reference ?? t('list.emptyValue')}</TableCell>
                  <TableCell>{receivedByName(payment) ?? t('list.emptyValue')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
