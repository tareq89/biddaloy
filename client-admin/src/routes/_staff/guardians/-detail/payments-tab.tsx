import { Card, DataTable } from '@biddaloy/ui/components';
import { usePaymentsByGuardian } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatDate, parseCurrency, parseServerDate } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

export interface PaymentsTabProps {
  guardianId: string;
}

/** [8.11.4]'s Payment History tab — every payment recorded for any of
 * this guardian's linked students (a guardian can have more than one
 * child, so the student column matters here). "Record payment" lives in the
 * page header, not in this tab. */
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
      {(payments) => (
        <Card className="overflow-hidden">
          <DataTable
            tableId="guardian-payments"
            caption={t('detail.tabs.payments')}
            paginated={false}
            sorting={null}
            onSortingChange={() => undefined}
            totalCount={payments.length}
            data={payments}
            getRowId={(payment) => payment.id}
            columns={[
              {
                id: 'date',
                header: t('detail.payments.columnDate'),
                accessorFn: (payment) =>
                  formatDate(parseServerDate(payment.payment_date), regionConfig),
                card: 'title',
              },
              {
                id: 'student',
                header: t('detail.payments.columnStudent'),
                accessorFn: (payment) => payment.student.full_name,
                card: 'subtitle',
              },
              {
                id: 'amount',
                header: t('detail.payments.columnAmount'),
                align: 'end',
                accessorFn: (payment) =>
                  formatCurrency(
                    parseCurrency(String(payment.total_amount), regionConfig),
                    regionConfig,
                  ),
              },
              {
                id: 'method',
                header: t('detail.payments.columnMethod'),
                accessorFn: (payment) =>
                  t(`enums.paymentMethod.${payment.payment_method}`, {
                    ns: 'common',
                    defaultValue: payment.payment_method,
                  }),
              },
              {
                id: 'reference',
                header: t('detail.payments.columnReference'),
                accessorFn: (payment) => payment.transaction_reference ?? t('list.emptyValue'),
              },
            ]}
            rowActions={(payment) => [
              {
                intent: 'view',
                label: t('detail.payments.view'),
                to: `/payments/${payment.id}`,
                'data-focus-anchor': payment.id,
              },
            ]}
            emptyState={{
              title: t('detail.payments.emptyMessage'),
              explanation: t('detail.payments.emptyExplanation'),
            }}
          />
        </Card>
      )}
    </TabQueryState>
  );
}
