import { Invoice } from './entities/invoice.entity';
import { IssuerSnapshot } from '../schools/profile/issuer-snapshot';
import {
  escapeHtml,
  formatAmount,
  formatDate,
  filterSnapshotForLinkedStudents,
  isCreditNote,
  signedAmount,
} from './invoice-print-format.util';

/** [16.5.2] The two thermal-receipt widths a POS printer driver reports —
 * 58 mm (32 monospace columns) and 80 mm (48 columns). `invoices.service.ts`
 * maps the `?format=pos58|pos80` query param onto this type. */
export type PosPrintWidth = 'pos58' | 'pos80';

const WIDTH_MM: Record<PosPrintWidth, number> = { pos58: 58, pos80: 80 };
const WIDTH_COLUMNS: Record<PosPrintWidth, number> = { pos58: 32, pos80: 48 };

/** A single dashed rule the full column width — thermal printers render a
 * horizontal line as a row of dashes rather than a CSS border, since a
 * `<hr>`/border can render as nothing at all on some 58 mm drivers. */
function rule(columns: number): string {
  return '-'.repeat(columns);
}

/** Two strings on one line, `right` flush to the far edge — the standard
 * "label ......... amount" receipt row. Built as flex in CSS rather than
 * literal padding, so it still lines up correctly however the printer's
 * monospace font actually measures (padding math can't know that; flex
 * can). Text itself must still avoid characters that don't exist on a
 * receipt printer's font — that's the caller's job (student names/fee
 * names are already whatever the school typed). */
function lineRow(left: string, right: string, opts?: { emphasis?: boolean }): string {
  const cls = opts?.emphasis ? ' class="row row-emphasis"' : ' class="row"';
  return `<div${cls}><span class="row-left">${left}</span><span class="row-right">${right}</span></div>`;
}

/** [16.5.2] POS receipt template — 58 mm or 80 mm thermal width, single
 * column, monospace-safe. Renders from the **snapshot** only (D21), same
 * as the A4 template — never re-queries bills.
 *
 * `linkedStudentIds` — see the identical parameter on
 * `renderInvoiceHtml` (A4): `undefined` for staff/admin (every student
 * renders), the caller's linked subset for a PARENT/STUDENT.
 *
 * `shareUrl` — the invoice's public share link, when one exists. No such
 * field exists yet ([16.5.3] is expected to add it); until then every
 * caller passes `null`/`undefined` and the QR block renders nothing, per
 * this ticket's `## Steps` ("render nothing if absent"). */
export function renderInvoicePosHtml(
  invoice: Invoice,
  issuer: IssuerSnapshot,
  logoDataUrl: string | null,
  width: PosPrintWidth,
  linkedStudentIds?: string[],
  shareUrl?: string | null,
): string {
  const widthMm = WIDTH_MM[width];
  const columns = WIDTH_COLUMNS[width];
  const creditNote = isCreditNote(invoice);
  const snapshot = filterSnapshotForLinkedStudents(invoice.snapshot, linkedStudentIds);
  const documentLabel = creditNote ? 'CREDIT NOTE' : 'RECEIPT';

  const studentSections = snapshot.students
    .map((s) => {
      const lineRows = s.lines
        .map((line) =>
          lineRow(
            escapeHtml(`${line.fee_name} (${line.period_label})`),
            formatAmount(signedAmount(line.amount, invoice)),
          ),
        )
        .join('');
      return `
        <div class="student-section">
          <div class="student-name">${escapeHtml(s.full_name)}</div>
          <div class="student-meta">Reg: ${escapeHtml(s.registration_number)}${s.class_name ? ` &middot; ${escapeHtml(s.class_name)}` : ''}</div>
          ${lineRows}
        </div>`;
    })
    .join(`<div class="rule">${rule(columns)}</div>`);

  const totals = snapshot.totals;
  const totalsBlock = `
    <div class="totals">
      ${lineRow('Billed', formatAmount(signedAmount(totals.billed, invoice)))}
      ${lineRow('Discount', formatAmount(-Math.abs(totals.discount)))}
      ${totals.wallet_used ? lineRow('Wallet used', formatAmount(-Math.abs(totals.wallet_used))) : ''}
      ${totals.wallet_added ? lineRow('Wallet added', formatAmount(signedAmount(totals.wallet_added, invoice))) : ''}
      ${lineRow('Paid', formatAmount(signedAmount(totals.paid, invoice)), { emphasis: true })}
      ${totals.change ? lineRow('Change', formatAmount(signedAmount(totals.change, invoice))) : ''}
    </div>`;

  const payment = snapshot.payment;
  const paymentLine = `Paid via ${escapeHtml(payment.method)}${payment.reference ? ` &middot; ${escapeHtml(payment.reference)}` : ''}`;

  // No public share link ([16.5.3] not yet built) — render nothing rather
  // than a QR block pointed at nothing. `data:` URL would need an actual
  // QR-encoding library, which is out of this ticket's scope; the field
  // it would encode doesn't exist on the snapshot yet either.
  const qrBlock = shareUrl
    ? `
    <div class="section qr-section">
      <div class="qr-caption">Scan for a copy of this receipt</div>
      <div class="qr-link">${escapeHtml(shareUrl)}</div>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${documentLabel} ${escapeHtml(invoice.invoice_number)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    color: #000;
    margin: 0;
    padding: 0;
    width: ${widthMm}mm;
    font-size: ${width === 'pos58' ? '11px' : '12px'};
  }
  .center { text-align: center; }
  .logo { max-width: 200px; max-height: 60px; margin: 0 auto 4px; display: block; filter: grayscale(1) contrast(1.4); }
  .school-name { font-weight: bold; font-size: 1.15em; }
  .school-detail { font-size: 0.9em; }
  .doc-label { font-weight: bold; margin-top: 4px; ${creditNote ? 'color: #000; border: 1px solid #000; display: inline-block; padding: 0 6px;' : ''} }
  .rule { white-space: pre; margin: 4px 0; }
  .section { margin: 6px 0; page-break-inside: avoid; }
  .student-section { page-break-inside: avoid; margin-bottom: 4px; }
  .student-name { font-weight: bold; }
  .student-meta { font-size: 0.85em; margin-bottom: 2px; }
  .row { display: flex; justify-content: space-between; gap: 4px; }
  .row-left { flex: 1; word-break: break-word; }
  .row-right { white-space: nowrap; }
  .row-emphasis { font-weight: bold; }
  .totals { margin-top: 4px; page-break-inside: avoid; }
  .payment-line { margin-top: 4px; }
  .qr-section { text-align: center; page-break-inside: avoid; }
  .qr-caption { font-size: 0.85em; }
  .qr-link { font-size: 0.75em; word-break: break-all; }
  .footer { text-align: center; margin-top: 8px; font-weight: bold; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="section center">
    ${issuer.logo_key && logoDataUrl ? `<img class="logo" src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(issuer.name)}" onerror="this.style.display='none'" />` : ''}
    <div class="school-name">${escapeHtml(issuer.name)}</div>
    ${issuer.address ? `<div class="school-detail">${escapeHtml(issuer.address)}</div>` : ''}
    ${issuer.phone ? `<div class="school-detail">${escapeHtml(issuer.phone)}</div>` : ''}
    <div class="doc-label">${documentLabel}</div>
  </div>

  <div class="rule">${rule(columns)}</div>

  <div class="section">
    ${lineRow('No.', escapeHtml(invoice.invoice_number))}
    ${lineRow('Date', formatDate(invoice.issued_date))}
  </div>

  <div class="rule">${rule(columns)}</div>

  <div class="section">
    ${studentSections || '<div class="student-section">No line items</div>'}
  </div>

  <div class="rule">${rule(columns)}</div>

  ${totalsBlock}

  <div class="payment-line">${paymentLine}</div>

  ${qrBlock}

  <div class="rule">${rule(columns)}</div>

  <div class="footer">Thank you</div>
</body>
</html>`;
}
