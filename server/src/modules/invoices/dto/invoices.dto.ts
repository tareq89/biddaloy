import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { Invoice } from '../entities/invoice.entity';
import { Student } from '../../students/entities/student.entity';
import { StudentFee } from '../../fees/entities/student-fee.entity';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { FamilyStudentFeeDto, toFamilyStudentFee } from '../../fees/dto/fees.dto';

export class LineItemDto {
  @IsString()
  @MaxLength(255)
  @SanitizeText()
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number = 1;
}

export class CreateInvoiceDto {
  @IsUUID()
  student_id: string;

  @IsOptional()
  @IsUUID()
  student_fee_id?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @SanitizeText()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  line_items?: LineItemDto[];
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
 * Family-facing view of an invoice [5.1].
 *
 * Allow-list, matching the discipline used for payments and fees. Two things
 * are withheld:
 *
 * - `issued_by` / `issued_by_user_id` — which staff member generated the
 *   invoice. `findOne` loads that relation as a full `User` (name, email and
 *   `password_hash` on the entity); the bare id is internal too.
 * - the raw `student_fee` relation — `findOne` and `findAll` both join it,
 *   and `StudentFee` carries `reminder_threshold_date`, the internal
 *   reminder plumbing this ticket strips everywhere else. It is re-shaped
 *   through `FamilyStudentFeeDto` rather than dropped, since the portal
 *   needs to say which month an invoice covers.
 *
 * `issued_by: null` is emitted rather than omitted so the response keeps a
 * stable shape against the staff variant that `toSafeInvoice` produces.
 */
export class FamilyInvoiceStudentDto {
  id: string;
  full_name: string;
  registration_number: string;
}

export class FamilyInvoiceDto {
  id: string;
  invoice_number: string;
  student_id: string;
  // Always the caller's own child — `findAll` is restricted to their linked
  // students and `findOne` runs `assertLinked` first. Still allow-listed to
  // the three fields an invoice header renders, rather than passing the
  // whole `Student` (date_of_birth, home_address, user_id, …) through.
  student: FamilyInvoiceStudentDto | null;
  student_fee_id: string | null;
  student_fee: FamilyStudentFeeDto | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: InvoiceStatus;
  issued_date: Date;
  due_date: Date;
  line_items: Invoice['line_items'];
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
}

export function toFamilyInvoice(invoice: Invoice): FamilyInvoiceDto {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    student_id: invoice.student_id,
    student: invoice.student
      ? {
          id: invoice.student.id,
          full_name: invoice.student.full_name,
          registration_number: invoice.student.registration_number,
        }
      : null,
    student_fee_id: invoice.student_fee_id,
    student_fee: invoice.student_fee ? toFamilyStudentFee(invoice.student_fee) : null,
    total_amount: invoice.total_amount,
    tax_amount: invoice.tax_amount,
    discount_amount: invoice.discount_amount,
    status: invoice.status,
    issued_date: invoice.issued_date,
    due_date: invoice.due_date,
    line_items: invoice.line_items,
    notes: invoice.notes,
    issued_by: null,
    created_at: invoice.created_at,
    updated_at: invoice.updated_at,
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
  student: Student;
  student_id: string;
  student_fee: StudentFee | null;
  student_fee_id: string | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: InvoiceStatus;
  issued_date: Date;
  due_date: Date;
  line_items: Invoice['line_items'];
  issued_by: UserResponseDto | null;
  issued_by_user_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}
