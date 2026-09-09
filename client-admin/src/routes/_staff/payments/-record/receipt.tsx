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
import { apiClient } from '@biddaloy/ui/api';
import { Button, toast } from '@biddaloy/ui/components';
import type { PaymentWithIssuer } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';

export interface ReceiptProps {
  payment: PaymentWithIssuer;
  studentName: string;
}

/** A logo is at most 512KB ([15.5.3]); 10s is generous even on a slow 3G link. */
const LOGO_FETCH_TIMEOUT_MS = 10_000;

/**
 * [15.5.7] Fetches `issuer.logo_key`'s bytes through the authenticated API
 * client (bearer token — a bare `<img src>` at `/schools/:id/logo` 401s,
 * since that route has no cookie/query-string auth path) and returns them
 * as a `data:` URL for direct embedding in the receipt's HTML string. The
 * receipt is opened as its own `blob:` document ([15.5.7]'s top comment),
 * where a relative `<img src>` couldn't carry the header even if the route
 * accepted one. `null` for no logo, or a failed/missing fetch — the
 * receipt still prints, just without the image.
 */
async function fetchIssuerLogoDataUrl(
  tenantId: string,
  logoKey: string | null | undefined,
): Promise<string | null> {
  if (!logoKey) return null;
  const filename = logoKey.split('/').pop() ?? '';
  const version = filename.replace(/\.[^.]+$/, '');
  try {
    const res = await apiClient.get<Blob>(`/schools/${tenantId}/logo`, {
      params: { v: version },
      responseType: 'blob',
      // `printReceipt` awaits this before it can hand the opened tab its
      // document, and `apiClient` has no default timeout — without a bound
      // here a stalled request leaves the print tab blank indefinitely.
      // On timeout axios rejects, the `catch` below returns `null`, and the
      // receipt prints without the logo.
      timeout: LOGO_FETCH_TIMEOUT_MS,
    });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read logo blob'));
      reader.readAsDataURL(res.data);
    });
  } catch {
    return null;
  }
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
function buildIssuerHeaderHtml(
  payment: PaymentWithIssuer,
  bengaliFirst: boolean,
  logoDataUrl: string | null,
): string {
  const issuer = payment.issuer;
  if (!issuer) return '';

  // `||`, not `??` — an empty `name_bn` (school hasn't set one) must fall
  // back to `name` exactly like `null`/`undefined` does, or a bn-first
  // region renders a blank primary name and drops the English one.
  const primaryName = bengaliFirst ? issuer.name_bn || issuer.name : issuer.name;
  const secondaryName = bengaliFirst ? (issuer.name_bn ? issuer.name : null) : issuer.name_bn;
  const logoUrl = issuer.logo_key ? logoDataUrl : null;

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
  logoDataUrl: string | null = null,
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
  const issuerHeader = buildIssuerHeaderHtml(payment, config.locale.startsWith('bn'), logoDataUrl);

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

/** `false` when the popup was blocked. Opens the window with an empty
 * document *before* fetching the logo (mirrors `invoices-tab.tsx`'s
 * `openPrintableInvoice`) — an `await` ahead of `window.open` falls
 * outside the click's user-activation window, so a browser's popup
 * blocker would silently drop it instead of returning `null`. */
export async function printReceipt(
  payment: PaymentWithIssuer,
  studentName: string,
  config: RegionConfig,
  labels: { period: string; amount: string },
): Promise<boolean> {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (printWindow === null) {
    return false;
  }

  const logoDataUrl = payment.issuer?.logo_key
    ? await fetchIssuerLogoDataUrl(payment.tenant_id, payment.issuer.logo_key)
    : null;
  const html = buildReceiptHtml(payment, studentName, config, labels, logoDataUrl);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  printWindow.location.href = url;
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
          void printReceipt(payment, studentName, config, labels).then((opened) => {
            if (!opened) toast.error(t('record.receipt.printError'));
          });
        }}
      >
        {t('record.receipt.printAction')}
      </Button>
    </div>
  );
}
