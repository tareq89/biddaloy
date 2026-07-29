import { IsString, IsEmail, IsOptional, IsUUID, IsArray, IsEnum, IsInt, Min, IsDateString, IsNotEmpty, Matches, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationMedium, EnrollmentStatus } from '@beton-boi/shared';

// Matches "01712345678", "+8801712345678", or "8801712345678" — Bangladesh
// mobile numbers (operator prefixes 13-19).
export const BD_PHONE_REGEX = /^(?:\+?880|0)1[3-9]\d{8}$/;

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
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
  gender?: string;

  @IsOptional()
  @IsString()
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
  full_name?: string;

  @IsOptional()
  @IsUUID()
  class_section_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roll_number?: number;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  home_address?: string;

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
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

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
  full_name: string;

  @IsOptional()
  @IsString()
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
  address?: string;

  @IsOptional()
  @IsString()
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
  full_name?: string;

  @IsOptional()
  @IsString()
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
  address?: string;

  @IsOptional()
  @IsString()
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
  guardian1_name: string;

  @IsNotEmpty({ message: 'Missing required field: guardian1_phone' })
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format: guardian1_phone' })
  guardian1_phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format: guardian1_email' })
  guardian1_email?: string;

  @IsOptional()
  guardian2_name?: string;

  @ValidateIf((o) => !!o.guardian2_name)
  @IsNotEmpty({ message: 'Missing required field: guardian2_phone (required when guardian2_name is provided)' })
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format: guardian2_phone' })
  guardian2_phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format: guardian2_email' })
  guardian2_email?: string;

  @IsOptional()
  home_address?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium, { message: 'Invalid preferred_communication value' })
  preferred_communication?: CommunicationMedium;
}

export class BulkUploadErrorDto {
  row: number;
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