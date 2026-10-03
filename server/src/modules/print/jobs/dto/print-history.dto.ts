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
import { PRINT_BATCH_CEILING } from '@biddaloy/shared';

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
