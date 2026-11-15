import { escapeHtml, formatDate } from './invoice-print-format.util';

/** [3.2.03, D8] How an invoice's payment arrived when it came from a guardian
 * submission (a staff-verified proof, or an online gateway payment). `null`
 * everywhere means a counter payment, which prints unchanged. Dates are ISO
 * strings so the type crosses the service boundary as plain data. */
export interface PaymentOrigin {
  source: 'PROOF' | 'ONLINE';
  /** PROOF: the payment method (e.g. BKASH). ONLINE: the gateway provider. */
  method: string;
  /** PROOF: normalised reference. ONLINE: the provider's TrxID. */
  trx_id: string | null;
  /** PROOF only: when the guardian submitted it. */
  submitted_at: string | null;
  /** PROOF only. Staff-facing; NEVER passed to the public receipt (D38). */
  verified_by_name: string | null;
  verified_at: string | null;
  /** ONLINE only: gateway settlement time. */
  paid_at: string | null;
}

/** One `[label, value]` row per fact; values are raw text, escaped by the caller. */
function originRows(o: PaymentOrigin, showVerifierName: boolean): [string, string][] {
  const rows: [string, string][] = [
    [o.source === 'ONLINE' ? 'Gateway / গেটওয়ে' : 'Method / মাধ্যম', o.method],
  ];
  if (o.trx_id) rows.push(['TrxID', o.trx_id]);
  if (o.source === 'PROOF') {
    if (o.submitted_at) rows.push(['Submitted on / জমার তারিখ', formatDate(o.submitted_at)]);
    if (o.verified_at) {
      rows.push([
        'Verified / যাচাই',
        showVerifierName && o.verified_by_name
          ? `by ${o.verified_by_name} on ${formatDate(o.verified_at)}`
          : `by the school on ${formatDate(o.verified_at)}`,
      ]);
    }
  } else if (o.paid_at) {
    rows.push(['Paid at / পরিশোধ', formatDate(o.paid_at)]);
  }
  return rows;
}

/** A4 block: a `<div class="section">` with a two-column table. */
export function renderOriginBlockA4(
  o: PaymentOrigin | null | undefined,
  showVerifierName: boolean,
): string {
  if (!o) return '';
  const rows = originRows(o, showVerifierName)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  return `<div class="section payment-origin">
    <h2>How it was paid / কীভাবে পরিশোধ হয়েছে</h2>
    <table><tbody>${rows}</tbody></table>
  </div>`;
}

/** POS block: label / value lines; the caller supplies its `lineRow` formatter. */
export function renderOriginBlockPos(
  o: PaymentOrigin | null | undefined,
  showVerifierName: boolean,
  row: (left: string, right: string) => string,
): string {
  if (!o) return '';
  const rows = originRows(o, showVerifierName)
    .map(([k, v]) => row(escapeHtml(k), escapeHtml(v)))
    .join('');
  return `<div class="section payment-origin"><div class="student-name">How it was paid</div>${rows}</div>`;
}
