/**
 * [16.5.5] The receipt body itself — purely presentational, no hooks, no
 * fetching, no router. It renders in three places that must look
 * identical: the public `/i/<token>` page, the checkout-success preview,
 * and this file's own Storybook stories — so it lives in `ui/`, not
 * `client-admin`, the same reason `issuer-header.tsx` (which this
 * composes) does: Storybook only globs `ui/src/**`
 * (`ui/.storybook/main.ts:25`), so a component that needs a POS/A4
 * preview story can only actually get one from here.
 *
 * `width` picks a Tailwind container class, not a media/print query —
 * POS 58mm and 80mm receipts render at that fixed width on screen too
 * (a cashier previewing before printing), not only inside `@media print`.
 */
import type { RegionConfig } from '../../i18n';
import { formatDate, formatServerAmount, parseServerDate } from '../../utils';

import { IssuerHeader, type IssuerSnapshot } from './issuer-header';

export interface InvoiceReceiptStudent {
  full_name: string;
}

export interface InvoiceReceiptData {
  invoice_number: string;
  kind?: 'INVOICE' | 'CREDIT_NOTE';
  issued_date: string;
  due_date: string;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  notes?: string | null;
  student: InvoiceReceiptStudent;
  issuer: IssuerSnapshot;
}

export interface InvoiceReceiptProps {
  receipt: InvoiceReceiptData;
  width: 'pos58' | 'pos80' | 'a4';
  logoUrl?: string | null;
  config: RegionConfig;
  /** Translated strings — kept as plain props rather than `useTranslation`
   * inside this component so it stays hook-free and usable from a
   * chrome-free public route that must never touch anything auth-shaped,
   * same reasoning `$token.tsx`'s own header comment documents. */
  labels: {
    creditNote: string;
    issuedDate: string;
    dueDate: string;
    tax: string;
    discount: string;
    total: string;
  };
}

const WIDTH_CLASSES: Record<InvoiceReceiptProps['width'], string> = {
  pos58: 'max-w-[58mm] text-xs',
  pos80: 'max-w-[80mm] text-sm',
  a4: 'max-w-[210mm] text-sm',
};

/** Pure — takes the DTO and renders it, nothing else. */
export function InvoiceReceipt({ receipt, width, logoUrl, config, labels }: InvoiceReceiptProps) {
  return (
    <div
      data-slot="invoice-receipt"
      className={`mx-auto flex w-full flex-col gap-3 print:gap-3 ${WIDTH_CLASSES[width]}`}
    >
      <IssuerHeader issuer={receipt.issuer} logoUrl={logoUrl ?? null} />

      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{receipt.invoice_number}</span>
        {receipt.kind === 'CREDIT_NOTE' && (
          <span className="rounded-full border border-destructive px-2 py-0.5 text-xs text-destructive">
            {labels.creditNote}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>{labels.issuedDate}</span>
          <span>{formatDate(parseServerDate(receipt.issued_date), config)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.dueDate}</span>
          <span>{formatDate(parseServerDate(receipt.due_date), config)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2">
        <div className="flex justify-between gap-2">
          <span>{labels.tax}</span>
          <span>{formatServerAmount(receipt.tax_amount, config)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{labels.discount}</span>
          <span>{formatServerAmount(receipt.discount_amount, config)}</span>
        </div>
        <div className="flex justify-between gap-2 font-semibold">
          <span>{labels.total}</span>
          <span>{formatServerAmount(receipt.total_amount, config)}</span>
        </div>
      </div>

      {receipt.notes != null && receipt.notes !== '' && (
        <p className="text-xs text-muted-foreground">{receipt.notes}</p>
      )}

      <p className="text-xs text-muted-foreground">{receipt.student.full_name}</p>
    </div>
  );
}
