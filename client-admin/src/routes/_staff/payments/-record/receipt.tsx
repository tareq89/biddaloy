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
import type { PaymentWithIssuer } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';

export interface ReceiptProps {
  payment: PaymentWithIssuer;
  studentName: string;
}

/**
 * [15.5.7] `/schools/:id/logo?v=<uuid>` from the frozen `logo_key` — same
 * construction as the server's own `buildLogoUrl`
 * (`server/src/modules/schools/profile/profile.service.ts`), rebuilt here
 * since the receipt has no direct access to that function. Returns `null`
 * when there's no logo to show at all.
 */
function buildIssuerLogoUrl(tenantId: string, logoKey: string | null | undefined): string | null {
  if (!logoKey) return null;
  const filename = logoKey.split('/').pop() ?? '';
  const version = filename.replace(/\.[^.]+$/, '');
  return `/api/v1/schools/${tenantId}/logo?v=${version}`;
}

/**
 * The receipt's HTML-string equivalent of `IssuerHeader`
 * (`@biddaloy/ui/components`'s React component) — this document is built
 * as a raw HTML string for a new print tab (see this file's own top
 * comment for why), so the shared React component can't render here
 * directly. Mirrors its exact rules: bn-first name ordering, logo only
 * when `logo_key` is set, `onerror` hides a broken image rather than
 * showing the icon.
 */
function buildIssuerHeaderHtml(payment: PaymentWithIssuer, bengaliFirst: boolean): string {
  const issuer = payment.issuer;
  if (!issuer) return '';

  const primaryName = bengaliFirst ? (issuer.name_bn ?? issuer.name) : issuer.name;
  const secondaryName = bengaliFirst ? (issuer.name_bn ? issuer.name : null) : issuer.name_bn;
  const logoUrl = buildIssuerLogoUrl(payment.tenant_id, issuer.logo_key);

  const details = [
    issuer.phone,
    issuer.email,
    issuer.registration_id ? `EIIN: ${issuer.registration_id}` : null,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => escapeHtml(v))
    .join(' &middot; ');

  return `
    <div class="issuer">
      ${logoUrl ? `<img class="issuer-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(issuer.name)}" onerror="this.style.display='none'" />` : ''}
      <div>
        <div class="issuer-name">${escapeHtml(primaryName)}</div>
        ${secondaryName ? `<div class="issuer-name-secondary">${escapeHtml(secondaryName)}</div>` : ''}
        ${issuer.address ? `<div class="issuer-detail">${escapeHtml(issuer.address)}</div>` : ''}
        ${details ? `<div class="issuer-detail">${details}</div>` : ''}
      </div>
    </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildReceiptHtml(
  payment: PaymentWithIssuer,
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

  // [15.5.7] Bengali-first name ordering when the active region's locale
  // is Bengali — same rule `IssuerHeader`'s `activeLanguage === 'bn'` uses.
  const issuerHeader = buildIssuerHeaderHtml(payment, config.locale.startsWith('bn'));

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
      .issuer { display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #ddd; }
      .issuer-logo { height: 3.5rem; width: 3.5rem; object-fit: contain; }
      .issuer-name { font-size: 1.1rem; font-weight: 600; }
      .issuer-name-secondary { font-size: 0.9rem; color: #555; }
      .issuer-detail { font-size: 0.8rem; color: #555; }
    </style>
  </head>
  <body>
    ${issuerHeader}
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
  payment: PaymentWithIssuer,
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
