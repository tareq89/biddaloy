import { Permission } from '@biddaloy/shared';
import { Button, DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useHasPermission, usePaymentsByStudent } from '@biddaloy/ui/hooks';
import type { FamilyPayment, Payment } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatDate, parseCurrency, parseServerDate } from '@biddaloy/ui/utils';
import { useNavigate } from '@tanstack/react-router';
import { PlusIcon, WalletIcon } from 'lucide-react';

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
  const { t: tPayments } = useTranslation('payments');
  const regionConfig = useRegionConfig();
  const navigate = useNavigate();
  const query = usePaymentsByStudent(studentId);
  const canRecord = useHasPermission(Permission.PAYMENT_RECORD);

  return (
    <div className="flex flex-col gap-3">
      {canRecord && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full md:w-auto"
            onClick={() =>
              void navigate({ to: '/payments/record', search: { student_id: studentId } })
            }
          >
            <PlusIcon className="size-4" aria-hidden />
            {tPayments('recordAction')}
          </Button>
        </div>
      )}
      <TabQueryState
        query={query}
        forbiddenMessage={t('detail.forbidden')}
        errorMessage={t('detail.payments.errorMessage')}
      >
        {(payments) => {
          const dateOf = (payment: Payment | FamilyPayment) =>
            formatDate(parseServerDate(payment.payment_date), regionConfig);
          const methodOf = (payment: Payment | FamilyPayment) =>
            t(`enums.paymentMethod.${payment.payment_method}`, {
              ns: 'common',
              defaultValue: payment.payment_method,
            });
          const columns: DataTableColumn<Payment | FamilyPayment>[] = [
            { id: 'date', header: t('detail.payments.columnDate'), accessorFn: dateOf },
            {
              id: 'amount',
              header: t('detail.payments.columnAmount'),
              align: 'end',
              accessorFn: (payment) =>
                formatCurrency(
                  parseCurrency(String(payment.total_amount), regionConfig),
                  regionConfig,
                ),
              card: 'title',
            },
            {
              id: 'method',
              header: t('detail.payments.columnMethod'),
              accessorFn: methodOf,
              card: 'subtitle',
            },
            {
              id: 'reference',
              header: t('detail.payments.columnReference'),
              accessorFn: (payment) => payment.transaction_reference ?? t('list.emptyValue'),
            },
            {
              id: 'receivedBy',
              header: t('detail.payments.columnReceivedBy'),
              accessorFn: (payment) => receivedByName(payment) ?? t('list.emptyValue'),
            },
          ];
          return (
            <DataTable
              tableId="student-payments"
              caption={t('detail.tabs.payments')}
              paginated={false}
              sorting={null}
              onSortingChange={() => {}}
              columns={columns}
              data={payments}
              getRowId={(payment) => payment.id}
              totalCount={payments.length}
              rowActions={(payment) => [
                {
                  intent: 'view',
                  label: t('detail.payments.view'),
                  to: `/payments/${payment.id}`,
                },
              ]}
              emptyState={{
                title: t('detail.payments.emptyMessage'),
                explanation: t('detail.payments.emptyExplanation'),
                icon: <WalletIcon aria-hidden="true" />,
              }}
            />
          );
        }}
      </TabQueryState>
    </div>
  );
}
