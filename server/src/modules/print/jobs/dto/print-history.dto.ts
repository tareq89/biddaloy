import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CERTIFICATE_SERIAL_CODE,
  DocumentKind,
  PRINT_BATCH_CEILING,
  STUDENT_CERTIFICATE_KINDS,
  type StudentCertificateKind,
} from '@biddaloy/shared';

export class ConfirmPrintJobDto {
  @ApiProperty({
    type: [String],
    description: 'Items that did NOT print correctly. Empty = all OK.',
  })
  @IsArray()
  @ArrayMaxSize(PRINT_BATCH_CEILING)
  @IsUUID('all', { each: true })
  failed_item_ids: string[];
}

export class ReprintPrintJobDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_BATCH_CEILING)
  @IsUUID('all', { each: true })
  item_ids: string[];
}

export class RevokePrintItemDto {
  @ApiProperty({ minLength: 1, maxLength: 280 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(280)
  reason: string;
}

export class SubjectHistoryQueryDto {
  @ApiProperty({ enum: ['STUDENT', 'STAFF', 'ACR'] })
  @IsIn(['STUDENT', 'STAFF', 'ACR'])
  subject_type: 'STUDENT' | 'STAFF' | 'ACR';

  @ApiProperty()
  @IsUUID()
  subject_id: string;
}

export class QueryPrintHistoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) document_kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() template_id?: string;
  @ApiPropertyOptional({ enum: ['STUDENT', 'STAFF', 'ACR'] })
  @IsOptional()
  @IsIn(['STUDENT', 'STAFF', 'ACR'])
  subject_type?: 'STUDENT' | 'STAFF' | 'ACR';
  @ApiPropertyOptional() @IsOptional() @IsUUID() subject_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() printed_by?: string;
  @ApiPropertyOptional({ description: 'ISO date or datetime, inclusive' })
  @IsOptional()
  @IsDateString({ strict: true })
  @MaxLength(40)
  from?: string;
  @ApiPropertyOptional({
    description: 'ISO date or datetime, inclusive (a date covers the whole day)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @MaxLength(40)
  to?: string;
  @ApiPropertyOptional({ enum: ['OPEN', 'CONFIRMED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CONFIRMED'])
  status?: 'OPEN' | 'CONFIRMED';
  @ApiPropertyOptional({ enum: ['PENDING', 'OK', 'FAILED'] })
  @IsOptional()
  @IsIn(['PENDING', 'OK', 'FAILED'])
  outcome?: 'PENDING' | 'OK' | 'FAILED';
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  revoked?: boolean;
  @ApiPropertyOptional({ description: 'Matches the subject label (case-insensitive contains)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

const SERIAL_KINDS = Object.keys(CERTIFICATE_SERIAL_CODE);

export class QueryRegisterDto {
  @ApiPropertyOptional({ enum: SERIAL_KINDS })
  @IsOptional()
  @IsIn(SERIAL_KINDS)
  document_kind?: string;
  @ApiPropertyOptional({ minimum: 2000, maximum: 2100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
  @ApiPropertyOptional({ description: 'Only copies issued to this student' })
  @IsOptional()
  @IsUUID()
  subject_id?: string;
  @ApiPropertyOptional({ enum: ['VALID', 'REVOKED'] })
  @IsOptional()
  @IsIn(['VALID', 'REVOKED'])
  status?: 'VALID' | 'REVOKED';
  @ApiPropertyOptional({
    description: 'Matches the holder name or the serial (case-insensitive contains)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class QueryIdCardQueueDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CertificateTemplatesQueryDto {
  @ApiProperty({ enum: STUDENT_CERTIFICATE_KINDS })
  @IsIn([...STUDENT_CERTIFICATE_KINDS])
  document_kind: StudentCertificateKind;
}

/* ------------------------------------------------------------ responses */

export class CertificateTemplateRowDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() is_default: boolean;
  @ApiProperty() current_version_id: string;
}

export class QueueKindCountDto {
  @ApiProperty({ enum: ['EXAM_ADMIT_CARD', 'STUDENT_ID_CARD'] })
  kind: 'EXAM_ADMIT_CARD' | 'STUDENT_ID_CARD';
  @ApiProperty() count: number;
}

export class QueueExamDto {
  @ApiProperty() exam_id: string;
  @ApiProperty() exam_name: string;
  @ApiProperty() class_name: string;
  @ApiProperty() missing: number;
}

export class PrintQueueDto {
  @ApiProperty() total: number;
  @ApiProperty({ type: [QueueKindCountDto] }) by_kind: QueueKindCountDto[];
  @ApiProperty({ type: [QueueExamDto] }) exams: QueueExamDto[];
}

export class IdCardQueueRowDto {
  @ApiProperty() student_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty() registration_number: string;
  @ApiProperty() class_name: string;
  @ApiProperty() section_name: string;
  @ApiProperty({ description: 'YYYY-MM-DD' }) admitted_on: string;
  @ApiProperty() has_photo: boolean;
}

export class IdCardQueuePageDto {
  @ApiProperty({ type: [IdCardQueueRowDto] }) data: IdCardQueueRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class RegisterRowDto {
  @ApiProperty() item_id: string;
  @ApiProperty({ enum: SERIAL_KINDS }) document_kind: DocumentKind;
  @ApiProperty() serial: string;
  @ApiProperty() serial_year: number;
  @ApiProperty() serial_no: number;
  @ApiProperty() copy_number: number;
  @ApiProperty() subject_id: string;
  @ApiProperty() subject_label: string;
  @ApiProperty({ nullable: true, type: String }) class_name: string | null;
  @ApiProperty() issued_at: string;
  @ApiProperty({ nullable: true, type: String }) printed_by_name: string | null;
  @ApiProperty({ nullable: true, type: String }) revoked_at: string | null;
  @ApiProperty({ nullable: true, type: String }) revoke_reason: string | null;
}

export class RegisterPageDto {
  @ApiProperty({ type: [RegisterRowDto] }) data: RegisterRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
