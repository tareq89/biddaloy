import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** [30.2.1] `GET /search` query params — a jump-to palette, not a list
 * page. `limit` defaults to 5 per group (matches the UI's pre-existing
 * `GLOBAL_SEARCH_LIMIT` in `ui/src/hooks/global-search.ts`) and is hard
 * capped at 10 so a caller can't turn this into a cheap way to page
 * through a whole roster five groups at a time. */
export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number = 5;
}

/** How a matched student row was found — `direct` when the query matched
 * the student's own name/registration/roll/class-section, `guardian_phone`
 * when it matched a linked guardian's phone number instead (the
 * cross-entity rule the ticket's Step 4 requires). The palette uses this
 * to render "via guardian phone" context on the result. */
export type StudentMatchedVia = 'direct' | 'guardian_phone';

export class SearchStudentResult {
  @ApiProperty()
  id: string;

  @ApiProperty()
  full_name: string;

  @ApiProperty()
  registration_number: string;

  @ApiProperty()
  roll_number: number;

  @ApiProperty({ nullable: true, type: 'string' })
  class_name: string | null;

  @ApiProperty({ nullable: true, type: 'string' })
  section_name: string | null;

  @ApiProperty({ enum: ['direct', 'guardian_phone'] })
  matched_via: StudentMatchedVia;
}

export class SearchGuardianResult {
  @ApiProperty()
  id: string;

  @ApiProperty()
  full_name: string;

  @ApiProperty({ nullable: true, type: 'string' })
  phone: string | null;
}

export class SearchStaffResult {
  @ApiProperty()
  id: string;

  @ApiProperty()
  full_name: string;

  @ApiProperty()
  employee_id: string;
}

export class SearchInvoiceResult {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoice_number: string;

  @ApiProperty({ nullable: true, type: 'string' })
  student_name: string | null;
}

export class SearchPaymentResult {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true, type: 'string' })
  transaction_reference: string | null;

  @ApiProperty({ nullable: true, type: 'string' })
  student_name: string | null;
}

/** A group absent from this object means the caller lacks the
 * permission that group needs (Step 5 of the plan: "a group the caller
 * cannot read is absent, not empty") — distinguish that from a present,
 * empty array, which means the caller *can* read the group and nothing
 * matched. */
export class SearchResultsDto {
  @ApiProperty({ type: () => [SearchStudentResult], required: false })
  students?: SearchStudentResult[];

  @ApiProperty({ type: () => [SearchGuardianResult], required: false })
  guardians?: SearchGuardianResult[];

  @ApiProperty({ type: () => [SearchStaffResult], required: false })
  staff?: SearchStaffResult[];

  @ApiProperty({ type: () => [SearchInvoiceResult], required: false })
  invoices?: SearchInvoiceResult[];

  @ApiProperty({ type: () => [SearchPaymentResult], required: false })
  payments?: SearchPaymentResult[];
}
