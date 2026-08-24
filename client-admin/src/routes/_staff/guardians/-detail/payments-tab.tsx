import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { usePaymentsByGuardian } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, parseCurrency } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

import { TabQueryState } from './tab-query-state';

export interface PaymentsTabProps {
  guardianId: string;
}

/** [8.11.4]'s Payment History tab — every payment recorded for any of
 * this guardian's linked students, each row linking to that student's own
 * page (a guardian can have more than one child, so which student a row
 * belongs to matters here in a way it doesn't on a single student's own
 * Payments tab). */
export function PaymentsTab({ guardianId }: PaymentsTabProps) {
  const { t } = useTranslation('guardians');
  const regionConfig = useRegionConfig();
  const query = usePaymentsByGuardian(guardianId);

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
                <TableHead>{t('detail.payments.columnStudent')}</TableHead>
                <TableHead>{t('detail.payments.columnAmount')}</TableHead>
                <TableHead>{t('detail.payments.columnMethod')}</TableHead>
                <TableHead>{t('detail.payments.columnReference')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{payment.payment_date}</TableCell>
                  <TableCell>
                    <Link
                      to="/students/$studentId"
                      params={{ studentId: payment.student.id }}
                      className="text-primary underline"
                    >
                      {payment.student.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {formatCurrency(
                      parseCurrency(String(payment.total_amount), regionConfig),
                      regionConfig,
                    )}
                  </TableCell>
                  <TableCell>{payment.payment_method}</TableCell>
                  <TableCell>{payment.transaction_reference ?? t('list.emptyValue')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
