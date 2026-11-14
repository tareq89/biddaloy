import { ApiProperty } from '@nestjs/swagger';
import { Invoice, InvoiceSnapshotLine } from './entities/invoice.entity';
import { IssuerSnapshot } from '../schools/profile/issuer-snapshot';
import { PaymentOrigin } from './invoice-payment-origin';
import { signedAmount } from './invoice-print-format.util';

/** Classes, not interfaces — same `@nestjs/swagger` CLI plugin reason as
 * `InvoiceSnapshot`'s own doc comment: this DTO is the route's return
 * type, but its nested shapes still need their own `@ApiProperty()` to
 * avoid an empty (`Record<string, never>`) response schema. */
export class PublicReceiptSchoolDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, type: 'string' })
  address: string | null;

  @ApiProperty({ nullable: true, type: 'string' })
  logo_url: string | null;
}

export class PublicReceiptStudentDto {
  @ApiProperty()
  full_name: string;

  @ApiProperty({ nullable: true, type: 'string' })
  class_name: string | null;

  @ApiProperty({ type: () => [InvoiceSnapshotLine] })
  lines: InvoiceSnapshotLine[];
}

export class PublicReceiptTotalsDto {
  @ApiProperty()
  billed: number;

  @ApiProperty()
  discount: number;

  @ApiProperty()
  paid: number;

  @ApiProperty()
  change: number;
}

export class PublicReceiptPaymentDto {
  @ApiProperty()
  method: string;

  @ApiProperty({ nullable: true, type: 'string' })
  reference_last4: string | null;

  @ApiProperty()
  payment_date: string;
}

/** [3.2.03, D38] How a guardian-submitted payment arrived. Deliberately has
 * NO verifier name: the public receipt says only "verified by the school". */
export class PublicReceiptHowPaidDto {
  @ApiProperty({ enum: ['PROOF', 'ONLINE'] })
  source: 'PROOF' | 'ONLINE';

  @ApiProperty()
  method: string;

  /** Masked to the last 4 characters like `payment.reference_last4` (Rule 13). */
  @ApiProperty({ nullable: true, type: 'string' })
  trx_id_last4: string | null;

  /** PROOF: the day the school verified it. ONLINE: null. */
  @ApiProperty({
    nullable: true,
    type: 'string',
    description: 'ISO timestamp; the client shows only the date ("verified by the school on ...").',
  })
  verified_on: string | null;

  /** ONLINE: when the gateway settled it. PROOF: null. */
  @ApiProperty({ nullable: true, type: 'string' })
  paid_at: string | null;
}

export class PublicReceiptDto {
  @ApiProperty()
  invoice_number: string;

  @ApiProperty()
  kind: string;

  @ApiProperty()
  issued_date: string;

  @ApiProperty({ type: () => PublicReceiptSchoolDto })
  school: PublicReceiptSchoolDto;

  @ApiProperty({ type: () => [PublicReceiptStudentDto] })
  students: PublicReceiptStudentDto[];

  @ApiProperty({ type: () => PublicReceiptTotalsDto })
  totals: PublicReceiptTotalsDto;

  @ApiProperty({ type: () => PublicReceiptPaymentDto })
  payment: PublicReceiptPaymentDto;

  /** `null` for a counter payment. */
  @ApiProperty({ type: () => PublicReceiptHowPaidDto, nullable: true })
  how_paid: PublicReceiptHowPaidDto | null;
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
  origin: PaymentOrigin | null = null,
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
    // A credit note's snapshot is copied verbatim from the invoice it
    // reverses and stays positive (see `InvoicesService.createCreditNote`);
    // sign every money field for display the same way the print templates
    // do (`invoice-print.template.ts`, `invoice-print-pos.template.ts`) —
    // `signedAmount` flips amount/discount/paid_this_time/totals for a
    // credit note, `totals.discount` is always shown as a deduction.
    students: snapshot.students.map((s) => ({
      full_name: s.full_name,
      class_name: s.class_name,
      lines: s.lines.map((line) => ({
        ...line,
        amount: signedAmount(line.amount, invoice),
        discount: signedAmount(line.discount, invoice),
        paid_this_time: signedAmount(line.paid_this_time, invoice),
      })),
    })),
    totals: {
      billed: signedAmount(snapshot.totals.billed, invoice),
      discount: -Math.abs(snapshot.totals.discount),
      paid: signedAmount(snapshot.totals.paid, invoice),
      change: signedAmount(snapshot.totals.change, invoice),
    },
    payment: {
      method: snapshot.payment.method,
      reference_last4: redactReference(snapshot.payment.reference),
      payment_date: snapshot.payment.payment_date,
    },
    // Allow-list copy: `verified_by_name` is never read here (D38).
    how_paid: origin
      ? {
          source: origin.source,
          method: origin.method,
          trx_id_last4: redactReference(origin.trx_id),
          verified_on: origin.verified_at,
          paid_at: origin.paid_at,
        }
      : null,
  };
}
