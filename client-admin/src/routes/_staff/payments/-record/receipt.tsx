/**
 * `WizardShell`'s `result` — replaces the whole step flow once the
 * payment is recorded (`wizard-shell.tsx`'s own render: `if (result)
 * return <>{title}{result}</>`), so there's no wizard chrome left to hide
 * from print output once this renders.
 *
 * `openPrintableInvoice` (`students/-detail/invoices-tab.tsx`) opens a
 * *server-rendered* HTML page (`GET /invoices/:id/print`) in a new tab —
 * there's no equivalent endpoint for a bare payment receipt, and a
 * partial payment has no invoice at all to fetch. `buildReceiptHtml`
 * below renders the same receipt content client-side instead, so one
 * code path covers both the full-payment (invoice generated) and
 * partial-payment (no invoice) case, rather than branching print
 * behaviour on which one happened. Building the HTML has no `await` in
 * it (unlike the invoice case), so this skips that function's
 * open-before-fetch dance — there's no async gap for a popup blocker to
 * catch the window open in.
 */
import { Button, toast } from '@biddaloy/ui/components';
import type { Payment } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';

export interface ReceiptProps {
  payment: Payment;
  studentName: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildReceiptHtml(
  payment: Payment,
  studentName: string,
  config: RegionConfig,
  labels: { period: string; amount: string },
): string {
  const money = (amount: number | string) => formatServerAmount(amount, config);
  const rows = payment.allocations
    .map(
      (allocation) => `
        <tr>
          <td>${escapeHtml(String(allocation.student_fee.month))}/${escapeHtml(String(allocation.student_fee.year))}</td>
          <td>${escapeHtml(money(allocation.allocated_amount))}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(studentName)}</title>
    <style>
      body { font-family: sans-serif; padding: 2rem; color: #111; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      td, th { text-align: left; padding: 0.35rem 0; border-bottom: 1px solid #ddd; }
      .total { font-weight: 600; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(studentName)}</h1>
    <p>${escapeHtml(new Date(payment.payment_date).toLocaleDateString(config.locale))} · ${escapeHtml(payment.payment_method)}${
      payment.transaction_reference !== null
        ? ` · ${escapeHtml(payment.transaction_reference)}`
        : ''
    }</p>
    <table>
      <thead>
        <tr><th>${escapeHtml(labels.period)}</th><th>${escapeHtml(labels.amount)}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="total">${escapeHtml(money(payment.total_amount))}</p>
    ${payment.invoice !== null ? `<p>${escapeHtml(payment.invoice.invoice_number)}</p>` : ''}
  </body>
</html>`;
}

/** `false` when the popup was blocked — same "open before any `await`"
 * reasoning `invoices-tab.tsx`'s `openPrintableInvoice` gives doesn't
 * apply here (no `await` between the click and `window.open`), but a
 * blocked popup is exactly as silent either way, so this still needs to
 * report failure rather than leave the click looking like a no-op — and
 * revoke the object URL immediately rather than leaking it for the full
 * 60s timeout when nothing is ever going to load it. */
export function printReceipt(
  payment: Payment,
  studentName: string,
  config: RegionConfig,
  labels: { period: string; amount: string },
): boolean {
  const html = buildReceiptHtml(payment, studentName, config, labels);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const printWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (printWindow === null) {
    URL.revokeObjectURL(url);
    return false;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function Receipt({ payment, studentName }: ReceiptProps) {
  const { t } = useTranslation('payments');
  const config = useRegionConfig();

  return (
    <div className="flex flex-col gap-4">
      <p role="status">
        {t('record.receipt.success', {
          amount: formatServerAmount(payment.total_amount, config),
          name: studentName,
        })}
      </p>
      {payment.invoice !== null && (
        <p className="text-sm text-muted-foreground">
          {t('record.receipt.invoiceGenerated', { number: payment.invoice.invoice_number })}
        </p>
      )}
      <Button
        type="button"
        onClick={() => {
          const labels = {
            period: t('record.allocate.columnPeriod'),
            amount: t('record.allocate.columnAllocated'),
          };
          if (!printReceipt(payment, studentName, config, labels)) {
            toast.error(t('record.receipt.printError'));
          }
        }}
      >
        {t('record.receipt.printAction')}
      </Button>
    </div>
  );
}
