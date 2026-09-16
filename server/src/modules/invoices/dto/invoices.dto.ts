import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceStatus, InvoiceKind, CommunicationMedium } from '@biddaloy/shared';
import { Invoice, InvoiceSnapshot } from '../entities/invoice.entity';
import { Student } from '../../students/entities/student.entity';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { IssuerSnapshot } from '../../schools/profile/issuer-snapshot';

/** [16.5.1] Manual invoice generation — staff-triggered backfill for a
 * payment that (for whatever reason) doesn't already have one. There is
 * no free-form line-item invoicing anymore: every invoice is built from
 * an existing payment's committed allocations via
 * `InvoicesService.create`. */
export class CreateInvoiceDto {
  @IsUUID()
  payment_id: string;
}

/** [16.5.2] `GET /invoices/:id/print?format=`. `@IsIn` (not `@IsEnum`)
 * since there's no shared enum for this — it's a route-shape detail, not
 * a domain concept. Optional: an absent `format` defaults to `a4` in the
 * controller, but a *present, invalid* value (e.g. `?format=pdf`) fails
 * validation and 400s rather than silently falling back. */
/** [16.5.4] `POST /invoices/:id/send` — only WHATSAPP and SMS are
 * supported (no push/email path for a one-off manual share send).
 * `guardian_id`, when given, must be linked to the invoice's student(s);
 * omitted, the controller falls back to the primary reminder guardian
 * (`resolveReminderAudience`). */
export class SendInvoiceDto {
  @IsIn([CommunicationMedium.WHATSAPP, CommunicationMedium.SMS])
  medium: CommunicationMedium.WHATSAPP | CommunicationMedium.SMS;

  @IsOptional()
  @IsUUID()
  guardian_id?: string;
}

export class PrintFormatQueryDto {
  @IsOptional()
  @IsIn(['a4', 'pos58', 'pos80'])
  format?: 'a4' | 'pos58' | 'pos80';
}

export class QueryInvoiceDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsDateString()
  from_date?: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  min_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  max_amount?: number;

  @IsOptional()
  @IsEnum(['issued_date', 'due_date', 'total_amount', 'invoice_number', 'status'])
  sort?: 'issued_date' | 'due_date' | 'total_amount' | 'invoice_number' | 'status';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

/**
 * Family-facing view of an invoice [5.1], updated for [16.5.1]'s
 * snapshot-based document.
 *
 * Allow-list, matching the discipline used for payments and fees. One
 * thing is withheld:
 *
 * - `issued_by` / `issued_by_user_id` — which staff member generated the
 *   invoice. `findOne` loads that relation as a full `User` (name, email
 *   and `password_hash` on the entity); the bare id is internal too.
 *
 * `snapshot` itself is safe to pass through unchanged — it's an
 * allow-listed shape by construction (`InvoiceSnapshot`), built once at
 * issue time from data the student's own family is already entitled to
 * see (their fees, their payment).
 *
 * `issued_by: null` is emitted rather than omitted so the response keeps a
 * stable shape against the staff variant that `toSafeInvoice` produces.
 */
export class FamilyInvoiceDto {
  id: string;
  invoice_number: string;
  kind: InvoiceKind;
  student_id: string;
  payment_id: string | null;
  related_invoice_id: string | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: InvoiceStatus;
  issued_date: Date;
  due_date: Date;
  snapshot: InvoiceSnapshot;
  notes: string | null;
  // Explicitly described rather than inferred: the plugin cannot build a
  // schema from the literal type `null` and reports it as a circular
  // dependency, which aborts OpenAPI generation once this DTO is registered
  // via `@ApiExtraModels`. The runtime value is always `null` — the staff
  // variant's `issued_by` user is withheld from family callers, and the key
  // is kept (rather than omitted) so both variants share a stable shape.
  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    nullable: true,
    description: 'Always `null` for a family caller; the staff variant carries the issuing user.',
  })
  issued_by: null;
  created_at: Date;
  updated_at: Date;
  // [15.5.5] Present when built from `InvoicesService.findOne` (which
  // resolves it against the live profile as a fallback); absent from the
  // `findAll` list, which doesn't pay for an extra school read per page.
  issuer?: IssuerSnapshot;
}

/** Redacts an `IssuerSnapshot` down to what a family caller is entitled to
 * see: the school's public identity, not its contact/registration
 * internals. */
function redactIssuer(issuer: IssuerSnapshot): IssuerSnapshot {
  return {
    name: issuer.name,
    name_bn: issuer.name_bn,
    address: issuer.address,
    logo_key: issuer.logo_key,
    // Withheld from family callers: `phone`, `email`, `registration_id`,
    // `captured_at` — internal/contact details, not needed to read a
    // receipt.
    phone: null,
    email: null,
    registration_id: null,
    captured_at: issuer.captured_at,
  };
}

/** Redacts `invoice.snapshot` for a family caller: `payment.received_by_name`
 * names the staff member who took the payment — internal, not the family's
 * business — and `issuer` is cut down to public identity fields. Everything
 * else (lines, totals, method/reference/payment_date) is what a family is
 * already entitled to see (their own fees and payment). */
function redactSnapshot(snapshot: InvoiceSnapshot): InvoiceSnapshot {
  return {
    ...snapshot,
    issuer: redactIssuer(snapshot.issuer),
    payment: {
      ...snapshot.payment,
      received_by_name: null,
    },
  };
}

export function toFamilyInvoice(invoice: Invoice & { issuer?: IssuerSnapshot }): FamilyInvoiceDto {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    kind: invoice.kind,
    student_id: invoice.student_id,
    payment_id: invoice.payment_id,
    related_invoice_id: invoice.related_invoice_id,
    total_amount: invoice.total_amount,
    tax_amount: invoice.tax_amount,
    discount_amount: invoice.discount_amount,
    status: invoice.status,
    issued_date: invoice.issued_date,
    due_date: invoice.due_date,
    snapshot: redactSnapshot(invoice.snapshot),
    notes: invoice.notes,
    issued_by: null,
    created_at: invoice.created_at,
    updated_at: invoice.updated_at,
    issuer: invoice.issuer ? redactIssuer(invoice.issuer) : invoice.issuer,
  };
}

/**
 * Swagger-only mirror of the staff `GET /invoices/:id` payload [5.1 review].
 *
 * `findOne` returns a role-dependent union — this shape for staff, a
 * `FamilyInvoiceDto` for a PARENT/STUDENT — which the Nest swagger plugin
 * cannot infer, so the route published an untyped body. Declaring the union
 * explicitly needs the staff variant to exist as a class the plugin can emit.
 *
 * It is *not* the `Invoice` entity: `toSafeInvoice` narrows `issued_by` from
 * the full `User` (password_hash included) to `UserResponseDto`. Pointing the
 * published contract at `Invoice` would advertise the very leak that helper
 * exists to prevent.
 *
 * `implements Omit<Invoice, 'issued_by'>` keeps the rest honest — a column
 * added to the entity fails the build here until it is mirrored.
 */
export class StaffInvoiceDto implements Omit<Invoice, 'issued_by'> {
  id: string;
  invoice_number: string;
  kind: InvoiceKind;
  student: Student;
  student_id: string;
  payment: Invoice['payment'];
  payment_id: string | null;
  related_invoice: Invoice['related_invoice'];
  related_invoice_id: string | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: InvoiceStatus;
  issued_date: Date;
  due_date: Date;
  snapshot: InvoiceSnapshot;
  issued_by: UserResponseDto | null;
  issued_by_user_id: string | null;
  notes: string | null;
  issuer_snapshot: IssuerSnapshot | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // [15.5.5] `issuer_snapshot ?? live profile` — see the note on
  // `FamilyInvoiceDto.issuer` for when this is/isn't populated.
  issuer?: IssuerSnapshot;
}

/** Response of `POST /invoices/:id/share` — see
 * `InvoicesController.createShareLink`. */
export class ShareLinkResponseDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  token_id: string;
}
