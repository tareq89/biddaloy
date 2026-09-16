import { Invoice } from './entities/invoice.entity';
import { Payment } from '../fees/entities/payment.entity';
import { IssuerSnapshot } from '../schools/profile/issuer-snapshot';
import {
  escapeHtml,
  formatAmount,
  formatDate,
  filterSnapshotForLinkedStudents,
  isCreditNote,
  signedAmount,
} from './invoice-print-format.util';

/** [15.5.7] Same header block `IssuerHeader` (`ui/src/components/print/
 * issuer-header.tsx`) renders client-side, built as a raw HTML string
 * here since this whole document is one — see that file's own comment on
 * why the shared React component can't render into either print path
 * directly. `logo_key` present means an `<img>` renders, pointed at the
 * versioned `/schools/:id/logo?v=<uuid>` URL; a later-removed logo 404s
 * and `onerror` hides it rather than showing a broken-image icon. */
function renderIssuerHeader(issuer: IssuerSnapshot, logoDataUrl: string | null): string {
  const secondaryName = issuer.name_bn;
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
        <div class="issuer-name">${escapeHtml(issuer.name)}</div>
        ${secondaryName ? `<div class="issuer-name-secondary">${escapeHtml(secondaryName)}</div>` : ''}
        ${issuer.address ? `<div class="issuer-detail">${escapeHtml(issuer.address)}</div>` : ''}
        ${details ? `<div class="issuer-detail">${details}</div>` : ''}
      </div>
    </div>`;
}

/** `logoDataUrl` — a `data:` URL for `issuer.logo_key`'s bytes, or `null`
 * (no logo, or the object is gone) — resolved by the caller via
 * `readLogoDataUrl` before render, since this file has no `StorageService`
 * access.
 *
 * `linkedStudentIds` — [664 follow-up, 665] when the caller is a
 * PARENT/STUDENT, the ids they're actually linked to (from
 * `FamilyAccessService.assertLinkedToAny`); `undefined` for staff/admin,
 * who see every student on the invoice. Filters `snapshot.students[]`
 * down the same way the JSON response already does, so a guardian linked
 * to only one of two siblings on a shared invoice never sees the other
 * child's name/registration number/fee lines in the printed HTML either. */
export function renderInvoiceHtml(
  invoice: Invoice,
  payments: Payment[],
  issuer: IssuerSnapshot,
  logoDataUrl: string | null,
  linkedStudentIds?: string[],
): string {
  const creditNote = isCreditNote(invoice);
  const snapshot = filterSnapshotForLinkedStudents(invoice.snapshot, linkedStudentIds);
  const snapshotStudents = snapshot.students;
  // [665] `invoice.student`/payment history are whole-payment/primary-student
  // concepts that don't narrow when `filterSnapshotForLinkedStudents` drops
  // an unlinked sibling — a guardian linked only to the non-primary student
  // must not see either block, since both can reveal the unlinked sibling's
  // identity or the full multi-student payment amount.
  const isPartialView =
    linkedStudentIds !== undefined && snapshotStudents.length < invoice.snapshot.students.length;

  // [16.5.1] `snapshot.students` groups lines by student (a multi-student
  // checkout, e.g. siblings, snapshots more than one) — flatten into rows
  // with a student column so the table still reads naturally for the
  // common single-student case.
  const lineItemRows = snapshotStudents
    .flatMap((s) =>
      s.lines.map(
        (line) => `
        <tr>
          <td>${escapeHtml(s.full_name)}</td>
          <td>${escapeHtml(line.fee_name)} (${escapeHtml(line.period_label)})</td>
          <td class="num">${formatAmount(signedAmount(line.amount, invoice))}</td>
          <td class="num">${formatAmount(signedAmount(line.discount, invoice))}</td>
          <td class="num">${formatAmount(signedAmount(line.paid_this_time, invoice))}</td>
        </tr>`,
      ),
    )
    .join('');

  const paymentRows = payments.length
    ? payments
        .map(
          (p) => `
        <tr>
          <td>${formatDate(p.payment_date)}</td>
          <td>${escapeHtml(p.payment_method)}</td>
          <td>${escapeHtml(p.transaction_reference ?? '-')}</td>
          <td class="num">${formatAmount(signedAmount(p.total_amount, invoice))}</td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No payments recorded yet</td></tr>';

  const subtotal = signedAmount(snapshot.totals.billed, invoice);
  const documentLabel = creditNote ? 'Credit Note' : 'Invoice';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${documentLabel} ${escapeHtml(invoice.invoice_number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 24px; }
  .header .school { font-size: 14px; color: #555; margin-top: 4px; }
  .header .meta { text-align: right; font-size: 13px; }
  .header .meta .invoice-number { font-size: 16px; font-weight: bold; }
  .issuer { display: flex; gap: 12px; align-items: flex-start; }
  .issuer-logo { height: 48px; width: 48px; object-fit: contain; }
  .issuer-name { font-size: 22px; font-weight: bold; }
  .issuer-name-secondary { font-size: 14px; color: #555; }
  .issuer-detail { font-size: 12px; color: #555; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; background: #eee; margin-top: 4px; }
  .credit-note-badge { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 13px; font-weight: bold; text-transform: uppercase; background: #fdecea; color: #c0392b; margin-top: 4px; letter-spacing: 0.05em; }
  .section { margin-bottom: 24px; }
  .section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin-bottom: 8px; }
  .student-details { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #f5f5f5; }
  td.num, th.num { text-align: right; }
  td.empty { text-align: center; color: #888; }
  .totals { width: 280px; margin-left: auto; margin-top: 12px; font-size: 14px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand-total { font-weight: bold; font-size: 16px; border-top: 2px solid #1a1a1a; margin-top: 4px; padding-top: 8px; }
  .notes { font-size: 13px; color: #555; margin-top: 24px; }
  ${creditNote ? '.credit-note-color { color: #c0392b; }' : ''}
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${renderIssuerHeader(issuer, logoDataUrl)}
      <div class="school">${documentLabel}</div>
    </div>
    <div class="meta">
      <div class="invoice-number">${escapeHtml(invoice.invoice_number)}</div>
      <div>Issued: ${formatDate(invoice.issued_date)}</div>
      <div>Due: ${formatDate(invoice.due_date)}</div>
      ${
        creditNote
          ? '<div class="credit-note-badge">Credit Note</div>'
          : `<div class="status">${escapeHtml(invoice.status)}</div>`
      }
    </div>
  </div>

  ${
    isPartialView
      ? ''
      : snapshotStudents
          .map(
            // [outside-diff fix] Student identity comes from the frozen
            // `snapshot`, not the live `student`/`classSection` relations —
            // a later name/class change must never alter an already-issued
            // document. Roll number/section aren't captured on
            // `InvoiceSnapshotStudent`, so they're omitted here rather than
            // falling back to the live (non-frozen) value.
            (s) => `<div class="section">
    <h2>Student</h2>
    <div class="student-details">
      <div><strong>Name:</strong> ${escapeHtml(s.full_name)}</div>
      <div><strong>Registration No.:</strong> ${escapeHtml(s.registration_number)}</div>
      <div><strong>Class:</strong> ${escapeHtml(s.class_name ?? '-')}</div>
    </div>
  </div>`,
          )
          .join('')
  }

  <div class="section">
    <h2>Fee Breakdown</h2>
    <table>
      <thead>
        <tr><th>Student</th><th>Fee</th><th class="num">Amount</th><th class="num">Discount</th><th class="num">Paid</th></tr>
      </thead>
      <tbody>
        ${lineItemRows || '<tr><td colspan="5" class="empty">No line items</td></tr>'}
      </tbody>
    </table>
    <div class="totals${creditNote ? ' credit-note-color' : ''}">
      <div><span>Billed</span><span>${formatAmount(subtotal)}</span></div>
      <div><span>Discount</span><span>${formatAmount(-Math.abs(snapshot.totals.discount))}</span></div>
      <div class="grand-total"><span>Paid</span><span>${formatAmount(signedAmount(snapshot.totals.paid, invoice))}</span></div>
    </div>
  </div>

  ${
    isPartialView
      ? ''
      : `<div class="section">
    <h2>Payment History</h2>
    <table>
      <thead>
        <tr><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>
        ${paymentRows}
      </tbody>
    </table>
  </div>`
  }

  ${invoice.notes ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</div>` : ''}
</body>
</html>`;
}
