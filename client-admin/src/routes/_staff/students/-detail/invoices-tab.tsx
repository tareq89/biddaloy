import { apiClient } from '@biddaloy/ui/api';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@biddaloy/ui/components';
import { useInvoices } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, parseCurrency } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

export interface InvoicesTabProps {
  studentId: string;
}

/** `apiClient` attaches the Authorization header itself
 * (`ui/src/api/client.ts`'s request interceptor) — a plain `<a href>` to
 * the API origin wouldn't carry it and the printable route would 401.
 * Same object-URL approach as [8.10.1]'s CSV export, just with an
 * HTML blob opened in a new tab instead of downloaded. A 403 (student
 * outside the caller's tenant) or a network failure rejects the request —
 * `onError` surfaces that instead of leaving the click looking like a
 * no-op. */
async function openPrintableInvoice(invoiceId: string, onError: () => void): Promise<void> {
  try {
    const res = await apiClient.get<string>(`/invoices/${invoiceId}/print`, {
      responseType: 'text',
    });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    onError();
  }
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
                  <TableCell>{invoice.status}</TableCell>
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
