import { Invoice, InvoiceSnapshotLine } from './entities/invoice.entity';
import { IssuerSnapshot } from '../schools/profile/issuer-snapshot';

export interface PublicReceiptStudentDto {
  full_name: string;
  class_name: string | null;
  lines: InvoiceSnapshotLine[];
}

export interface PublicReceiptDto {
  invoice_number: string;
  kind: string;
  issued_date: string;
  school: {
    name: string;
    address: string | null;
    logo_url: string | null;
  };
  students: PublicReceiptStudentDto[];
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

/** Redacts everything but the last 4 characters of a payment reference —
 * e.g. a bKash/bank transaction id — before it ever leaves the server on
 * the public, unauthenticated receipt route. `null`/short (<=4 chars)
 * references are left alone: there is nothing meaningful left to mask,
 * and padding a 3-char reference with asterisks would make it *look*
 * redacted while actually publishing the whole thing anyway. */
export function redactReference(reference: string | null): string | null {
  if (!reference) return null;
  if (reference.length <= 4) return reference;
  return `${'*'.repeat(reference.length - 4)}${reference.slice(-4)}`;
}

/**
 * [#666] Shapes the public, receipt-only view of an invoice from its
 * frozen `snapshot` — deliberately narrower than the staff/family JSON
 * (`toSafeInvoice`/`toFamilyInvoice`) and the printable HTML
 * (`invoice-print.template.ts`): no `registration_number` (an
 * internal/administrative identifier, not something a receipt needs), no
 * `received_by_name`, no invoice `notes`/remarks, and the payment
 * reference is redacted to its last 4 characters. Everything else needed
 * to recognize "yes, this is my receipt for this payment" — school
 * identity, invoice number, date, students' names/classes, fee lines,
 * totals, payment method — passes through unfiltered.
 */
export function buildPublicReceiptDto(
  invoice: Invoice,
  issuer: IssuerSnapshot,
  logoUrl: string | null,
): PublicReceiptDto {
  const { snapshot } = invoice;
  return {
    invoice_number: invoice.invoice_number,
    kind: invoice.kind,
    issued_date:
      invoice.issued_date instanceof Date ? invoice.issued_date.toISOString() : invoice.issued_date,
    school: {
      name: issuer.name,
      address: issuer.address,
      logo_url: logoUrl,
    },
    students: snapshot.students.map((s) => ({
      full_name: s.full_name,
      class_name: s.class_name,
      lines: s.lines,
    })),
    totals: {
      billed: snapshot.totals.billed,
      discount: snapshot.totals.discount,
      paid: snapshot.totals.paid,
      change: snapshot.totals.change,
    },
    payment: {
      method: snapshot.payment.method,
      reference_last4: redactReference(snapshot.payment.reference),
      payment_date: snapshot.payment.payment_date,
    },
  };
}
