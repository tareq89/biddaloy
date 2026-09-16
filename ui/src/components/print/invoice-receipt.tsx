/**
 * [16.5.5] The receipt body itself — purely presentational, no hooks, no
 * fetching, no router. Renders `PublicReceiptDto`
 * (`server/src/modules/invoices/public-invoice-receipt.dto.ts`)'s shape:
 * a redacted, receipt-only view of an invoice — school identity, every
 * paying student's fee lines (a multi-student/sibling checkout covers
 * more than one), totals, and how the money was received. It renders in
 * two places that must look identical: the public `/i/<token>` page and
 * this file's own Storybook stories — so it lives in `ui/`, not
 * `client-admin`: Storybook only globs `ui/src/**` (`ui/.storybook/
 * main.ts:25`), so a component that needs a preview story can only
 * actually get one from here.
 *
 * `width` picks a Tailwind container class, not a media/print query —
 * POS 58mm and 80mm receipts render at that fixed width on screen too
 * (a cashier previewing before printing), not only inside `@media print`.
 */
import type { RegionConfig } from '../../i18n';
import { formatDate, formatServerAmount, parseServerDate } from '../../utils';

export interface InvoiceReceiptLine {
  fee_name: string;
  period_label: string;
  amount: number;
  discount: number;
  paid_this_time: number;
  balance_after: number;
}

export interface InvoiceReceiptStudent {
  full_name: string;
  class_name: string | null;
  lines: InvoiceReceiptLine[];
}

export interface InvoiceReceiptData {
  invoice_number: string;
  kind?: 'INVOICE' | 'CREDIT_NOTE';
  issued_date: string;
  school: {
    name: string;
    address: string | null;
    logo_url: string | null;
  };
  students: InvoiceReceiptStudent[];
  totals: {
    billed: number;
    discount: number;
    paid: number;
    change: number;
  };
  payment: {
    method: string;
    reference_last4: string | null;
    payment_date: string;
  };
}

export interface InvoiceReceiptProps {
  receipt: InvoiceReceiptData;
  width: 'pos58' | 'pos80' | 'a4';
  config: RegionConfig;
  /** Translated strings — kept as plain props rather than `useTranslation`
   * inside this component so it stays hook-free and usable from a
   * chrome-free public route that must never touch anything auth-shaped,
   * same reasoning `$token.tsx`'s own header comment documents. */
  labels: {
    creditNote: string;
    issuedDate: string;
    billed: string;
    discount: string;
    paid: string;
    change: string;
    paymentMethod: string;
    paymentDate: string;
  };
}

const WIDTH_CLASSES: Record<InvoiceReceiptProps['width'], string> = {
  pos58: 'max-w-[58mm] text-xs',
  pos80: 'max-w-[80mm] text-sm',
  a4: 'max-w-[210mm] text-sm',
};

/** Pure — takes the DTO and renders it, nothing else. */
export function InvoiceReceipt({ receipt, width, config, labels }: InvoiceReceiptProps) {
  return (
    <div
      data-slot="invoice-receipt"
      className={`mx-auto flex w-full flex-col gap-3 print:gap-3 ${WIDTH_CLASSES[width]}`}
    >
      <div className="flex items-center gap-2">
        {receipt.school.logo_url && (
          <img
            src={receipt.school.logo_url}
            alt={receipt.school.name}
            className="size-10 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div>
          <div className="font-semibold">{receipt.school.name}</div>
          {receipt.school.address && (
            <div className="text-xs text-muted-foreground">{receipt.school.address}</div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{receipt.invoice_number}</span>
        {receipt.kind === 'CREDIT_NOTE' && (
          <span className="rounded-full border border-destructive px-2 py-0.5 text-xs text-destructive">
            {labels.creditNote}
          </span>
        )}
      </div>

      <div className="flex justify-between gap-2 text-muted-foreground">
        <span>{labels.issuedDate}</span>
        <span>{formatDate(parseServerDate(receipt.issued_date), config)}</span>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-2">
        {receipt.students.map((student, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="font-medium">
              {student.full_name}
              {student.class_name ? ` · ${student.class_name}` : ''}
            </div>
            {student.lines.map((line, j) => (
              <div key={j} className="flex justify-between gap-2 text-muted-foreground">
                <span>
                  {line.fee_name}
                  {line.period_label ? ` (${line.period_label})` : ''}
                </span>
                <span>{formatServerAmount(line.paid_this_time, config)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2">
        <div className="flex justify-between gap-2">
          <span>{labels.billed}</span>
          <span>{formatServerAmount(receipt.totals.billed, config)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.discount}</span>
          <span>{formatServerAmount(receipt.totals.discount, config)}</span>
        </div>
        <div className="flex justify-between gap-2 font-semibold">
          <span>{labels.paid}</span>
          <span>{formatServerAmount(receipt.totals.paid, config)}</span>
        </div>
        {receipt.totals.change > 0 && (
          <div className="flex justify-between gap-2">
            <span>{labels.change}</span>
            <span>{formatServerAmount(receipt.totals.change, config)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2 text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>{labels.paymentMethod}</span>
          <span>
            {receipt.payment.method}
            {receipt.payment.reference_last4 ? ` · ${receipt.payment.reference_last4}` : ''}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.paymentDate}</span>
          <span>{formatDate(parseServerDate(receipt.payment.payment_date), config)}</span>
        </div>
      </div>
    </div>
  );
}
