import {
  IsString,
  IsEmail,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  Min,
  IsDateString,
  IsNotEmpty,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

// Matches "01712345678", "+8801712345678", or "8801712345678" — Bangladesh
// mobile numbers (operator prefixes 13-19).
export const BD_PHONE_REGEX = /^(?:\+?880|0)1[3-9]\d{8}$/;

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  @SanitizeText()
  full_name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsUUID()
  class_section_id: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roll_number?: number;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  gender?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  home_address?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @SanitizeText()
  full_name?: string;

  @IsOptional()
  @IsUUID()
  class_section_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roll_number?: number;

  // `| null` (not just optional) — `@IsOptional()` already skips the
  // string/date-format validators below for `null` same as `undefined`,
  // and `StudentService.update` spreads the DTO straight into a TypeORM
  // partial update, so an explicit `null` clears the column. Without the
  // `| null` in the type, editing a student had no way to *remove* a
  // previously-set date of birth, gender or address — an absent key means
  // "leave unchanged" in a PATCH, so the client's only option was to omit
  // the field entirely, which never clears it.
  @IsOptional()
  @IsDateString()
  date_of_birth?: string | null;

  @IsOptional()
  @IsString()
  @SanitizeText()
  gender?: string | null;

  @IsOptional()
  @IsString()
  @SanitizeText()
  home_address?: string | null;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];
}

export class QueryStudentDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

  /** Allowlisted, not free-text — a raw column name from the client would
   * let `order: { [query.sort]: ... }` in `StudentService.findAll` sort
   * (or, with a crafted key, error on) an arbitrary TypeORM-mapped column.
   * `roll_number` deliberately excluded: it's only unique per class
   * section (see this entity's own composite unique index), so sorting
   * the whole tenant by it produces a confusing, repeating sequence. */
  @IsOptional()
  @IsIn(['full_name', 'registration_number', 'created_at'])
  sort?: 'full_name' | 'registration_number' | 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
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
  limit?: number = 10;
}

export class CreateGuardianDto {
  @IsString()
  @IsNotEmpty()
  @SanitizeText()
  full_name: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  relationship?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  alternate_phone?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  address?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  occupation?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @SanitizeText()
  full_name?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  relationship?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // [8.11.4]'s edit-guardian dialog sends `''` (not an omitted key) to
  // explicitly clear an optional field — `GuardianService.update` maps
  // that to a real NULL. `@IsEmail()` alone would reject `''` as an
  // invalid address, so it's skipped for that one case; a non-empty
  // value still has to be a real email.
  @IsOptional()
  @ValidateIf((o: UpdateGuardianDto) => o.email !== '')
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  alternate_phone?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  address?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  occupation?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

/**
 * One row of a bulk-upload spreadsheet, validated after empty cells have
 * been normalized to `undefined` (see StudentBulkUploadService.toDtoInput).
 * "Essential" fields are required; the rest of the fixed column schema is
 * optional per row.
 */
export class BulkUploadRowDto {
  @IsNotEmpty({ message: 'Missing required field: student_name' })
  @SanitizeText()
  student_name: string;

  @IsNotEmpty({ message: 'Missing required field: class' })
  class: string;

  @IsNotEmpty({ message: 'Missing required field: section' })
  section: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'roll must be a positive whole number' })
  roll?: string;

  // Accepted for a uniform column schema, but always ignored — registration
  // numbers are system-generated (see StudentService.create).
  @IsOptional()
  registration_number?: string;

  @IsNotEmpty({ message: 'Missing required field: guardian1_name' })
  @SanitizeText()
  guardian1_name: string;

  @IsNotEmpty({ message: 'Missing required field: guardian1_phone' })
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format: guardian1_phone' })
  guardian1_phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format: guardian1_email' })
  guardian1_email?: string;

  @IsOptional()
  @SanitizeText()
  guardian2_name?: string;

  @ValidateIf((o) => !!o.guardian2_name)
  @IsNotEmpty({
    message: 'Missing required field: guardian2_phone (required when guardian2_name is provided)',
  })
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format: guardian2_phone' })
  guardian2_phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format: guardian2_email' })
  guardian2_email?: string;

  @IsOptional()
  @SanitizeText()
  home_address?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium, { message: 'Invalid preferred_communication value' })
  preferred_communication?: CommunicationMedium;
}

export class BulkUploadErrorDto {
  row: number;
  /** Spreadsheet column the problem sits in (e.g. `guardian1_phone`,
   * `class`, `roll`). Absent when the problem spans the whole row. */
  field?: string;
  /** The offending cell's raw value, so the reporter can show exactly
   * what to fix. Absent when there is no single offending value. */
  value?: string;
  reason: string;
}

export class BulkUploadResultDto {
  total_rows: number;
  success_count: number;
  error_count: number;
  created_student_ids: string[];
  errors: BulkUploadErrorDto[];
}

export class QueryGuardianDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
