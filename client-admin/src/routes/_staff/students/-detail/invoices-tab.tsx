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
 * no-op.
 *
 * The tab is opened *before* the `await`, still inside the click's user-
 * activation window — opening it only after the request resolves is
 * outside that window, so a browser's popup blocker can silently drop it
 * (`window.open` returning `null` with no error). `.opener` is cleared by
 * hand instead of passing `noopener` to `window.open`, since `noopener`
 * would also drop the window reference this needs to navigate later. */
async function openPrintableInvoice(invoiceId: string, onError: () => void): Promise<void> {
  const printWindow = window.open('', '_blank', 'noreferrer');
  if (!printWindow) {
    onError();
    return;
  }
  printWindow.opener = null;

  try {
    const res = await apiClient.get<string>(`/invoices/${invoiceId}/print`, {
      responseType: 'text',
    });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
    printWindow.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    printWindow.close();
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
