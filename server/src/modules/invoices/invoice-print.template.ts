import { Invoice } from './entities/invoice.entity';
import { Payment } from '../fees/entities/payment.entity';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatDate(value: Date | string): string {
  const d = new Date(value);
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

function formatAmount(value: number | string): string {
  return Number(value).toFixed(2);
}

export function renderInvoiceHtml(invoice: Invoice, payments: Payment[]): string {
  const student = invoice.student;
  const classSection = student.class_section;
  const schoolName = student.tenant?.name ?? '';

  const lineItemRows = (invoice.line_items ?? [])
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.description)}</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${formatAmount(item.amount)}</td>
          <td class="num">${formatAmount(item.total)}</td>
        </tr>`,
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
          <td class="num">${formatAmount(p.total_amount)}</td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No payments recorded yet</td></tr>';

  const subtotal = (invoice.line_items ?? []).reduce((sum, item) => sum + Number(item.total), 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Invoice ${escapeHtml(invoice.invoice_number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { margin: 0 0 4px; font-size: 22px; }
  .header .school { font-size: 14px; color: #555; }
  .header .meta { text-align: right; font-size: 13px; }
  .header .meta .invoice-number { font-size: 16px; font-weight: bold; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; background: #eee; margin-top: 4px; }
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
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escapeHtml(schoolName)}</h1>
      <div class="school">Invoice</div>
    </div>
    <div class="meta">
      <div class="invoice-number">${escapeHtml(invoice.invoice_number)}</div>
      <div>Issued: ${formatDate(invoice.issued_date)}</div>
      <div>Due: ${formatDate(invoice.due_date)}</div>
      <div class="status">${escapeHtml(invoice.status)}</div>
    </div>
  </div>

  <div class="section">
    <h2>Student</h2>
    <div class="student-details">
      <div><strong>Name:</strong> ${escapeHtml(student.full_name)}</div>
      <div><strong>Registration No.:</strong> ${escapeHtml(student.registration_number)}</div>
      <div><strong>Class:</strong> ${escapeHtml(classSection?.class?.name ?? '-')}</div>
      <div><strong>Section:</strong> ${escapeHtml(classSection?.section_name ?? '-')} (Roll ${escapeHtml(student.roll_number)})</div>
    </div>
  </div>

  <div class="section">
    <h2>Fee Breakdown</h2>
    <table>
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Amount</th><th class="num">Total</th></tr>
      </thead>
      <tbody>
        ${lineItemRows || '<tr><td colspan="4" class="empty">No line items</td></tr>'}
      </tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${formatAmount(subtotal)}</span></div>
      <div><span>Tax</span><span>${formatAmount(invoice.tax_amount)}</span></div>
      <div><span>Discount</span><span>-${formatAmount(invoice.discount_amount)}</span></div>
      <div class="grand-total"><span>Total</span><span>${formatAmount(invoice.total_amount)}</span></div>
    </div>
  </div>

  <div class="section">
    <h2>Payment History</h2>
    <table>
      <thead>
        <tr><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>
        ${paymentRows}
      </tbody>
    </table>
  </div>

  ${invoice.notes ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</div>` : ''}
</body>
</html>`;
}
