import { InvoiceStatus } from '@biddaloy/shared';
import {
  Button,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@biddaloy/ui/components';
import { openPrintableInvoice, useInvoices } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, parseCurrency } from '@biddaloy/ui/utils';

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
      {(invoicesPage) =>
        invoicesPage.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.invoices.emptyMessage')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.invoices.columnNumber')}</TableHead>
                <TableHead>{t('detail.invoices.columnAmount')}</TableHead>
                <TableHead>{t('detail.invoices.columnStatus')}</TableHead>
                <TableHead>{t('detail.invoices.columnDueDate')}</TableHead>
                <TableHead>{t('detail.invoices.print')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoicesPage.data.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoice_number}</TableCell>
                  <TableCell>
                    {formatCurrency(
                      parseCurrency(String(invoice.total_amount), regionConfig),
                      regionConfig,
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge domain="invoice" status={invoice.status as InvoiceStatus} />
                  </TableCell>
                  <TableCell>{invoice.due_date}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() =>
                        void openPrintableInvoice(invoice.id, () =>
                          toast.error(t('detail.invoices.printError')),
                        )
                      }
                    >
                      {t('detail.invoices.print')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
