import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { usePaymentsByStudent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, parseCurrency } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

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
                  <TableCell>{payment.received_by?.full_name ?? t('list.emptyValue')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
