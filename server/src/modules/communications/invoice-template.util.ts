/**
 * [16.5.4] bn/en message text for an invoice receipt notification — the
 * manual `POST /invoices/:id/send` route and the automatic
 * `payments.recorded` listener both render through this one function, so
 * the two paths can never drift in wording.
 *
 * Reuses `formatFeeNotificationAmount` from `fee-notification-template.util`
 * for the amount (grouped thousands, Bengali-digit conversion in `bn`) —
 * same "headline number" formatting rule, no reason to duplicate it.
 */

import {
  formatFeeNotificationAmount,
  type FeeNotificationLocale,
} from './fee-notification-template.util';

export type InvoiceNotificationLocale = FeeNotificationLocale;

/**
 * bn: "রসিদ INV-2026-000317 · ৫,০০০ টাকা গৃহীত · দেখুন: <link>"
 * en: "Receipt INV-2026-000317 · 5,000 BDT received · View: <link>"
 */
export function buildInvoiceReceiptMessage(
  locale: InvoiceNotificationLocale,
  invoiceNumber: string,
  amountPaid: number,
  shareUrl: string,
): string {
  const amountText = formatFeeNotificationAmount(locale, amountPaid);
  return locale === 'bn'
    ? `রসিদ ${invoiceNumber} · ${amountText} টাকা গৃহীত · দেখুন: ${shareUrl}`
    : `Receipt ${invoiceNumber} · ${amountText} BDT received · View: ${shareUrl}`;
}
