import type { InvoiceReceiptData } from '@biddaloy/ui/components';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatMonth } from '@biddaloy/ui/utils';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The server snapshots `period_label` as "<English month> <year>" (invoices.service.ts:102).
 * Anything that does not match that shape is returned as it is. */
export function localizePeriod(label: string, config: RegionConfig): string {
  const match = /^([A-Za-z]+) (\d{4})$/.exec(label);
  const index = match ? MONTHS.indexOf(match[1]!) : -1;
  return index < 0
    ? label
    : formatMonth(`${match![2]}-${String(index + 1).padStart(2, '0')}`, config);
}

/** Receipt data with the month and payment method put into the visitor's language. */
export function toDisplayReceipt(
  receipt: InvoiceReceiptData,
  config: RegionConfig,
  methodLabel: (method: string) => string,
): InvoiceReceiptData {
  return {
    ...receipt,
    students: receipt.students.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({ ...l, period_label: localizePeriod(l.period_label, config) })),
    })),
    payment: { ...receipt.payment, method: methodLabel(receipt.payment.method) },
  };
}
