import { InvoiceStatus } from '@biddaloy/shared';
import { DataTable, StatusBadge, toast, type DataTableColumn } from '@biddaloy/ui/components';
import { openPrintableInvoice, useInvoices } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatDate, parseCurrency, parseServerDate } from '@biddaloy/ui/utils';
import { FileTextIcon } from 'lucide-react';

import { TabQueryState } from './tab-query-state';

export interface InvoicesTabProps {
  studentId: string;
}

export function InvoicesTab({ studentId }: InvoicesTabProps) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const query = useInvoices({ student_id: studentId });

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.invoices.errorMessage')}
    >
      {(invoicesPage) => {
        type Row = (typeof invoicesPage.data)[number];
        const columns: DataTableColumn<Row>[] = [
          {
            id: 'number',
            header: t('detail.invoices.columnNumber'),
            accessorFn: (invoice) => invoice.invoice_number,
            card: 'title',
          },
          {
            id: 'amount',
            header: t('detail.invoices.columnAmount'),
            align: 'end',
            accessorFn: (invoice) =>
              formatCurrency(
                parseCurrency(String(invoice.total_amount), regionConfig),
                regionConfig,
              ),
          },
          {
            id: 'status',
            header: t('detail.invoices.columnStatus'),
            accessorFn: (invoice) => (
              <StatusBadge domain="invoice" status={invoice.status as InvoiceStatus} />
            ),
            card: 'badge',
          },
          {
            id: 'dueDate',
            header: t('detail.invoices.columnDueDate'),
            accessorFn: (invoice) =>
              invoice.due_date ? formatDate(parseServerDate(invoice.due_date), regionConfig) : '—',
          },
        ];
        return (
          <DataTable
            tableId="student-invoices"
            caption={t('detail.tabs.invoices')}
            paginated={false}
            sorting={null}
            onSortingChange={() => {}}
            columns={columns}
            data={invoicesPage.data}
            getRowId={(invoice) => invoice.id}
            totalCount={invoicesPage.data.length}
            rowActions={(invoice) => [
              { intent: 'view', label: t('detail.invoices.view'), to: `/invoices/${invoice.id}` },
              {
                intent: 'print',
                label: t('detail.invoices.print'),
                onClick: () =>
                  void openPrintableInvoice(invoice.id, () =>
                    toast.error(t('detail.invoices.printError')),
                  ),
              },
            ]}
            emptyState={{
              title: t('detail.invoices.emptyMessage'),
              explanation: t('detail.invoices.emptyExplanation'),
              icon: <FileTextIcon aria-hidden="true" />,
            }}
          />
        );
      }}
    </TabQueryState>
  );
}
