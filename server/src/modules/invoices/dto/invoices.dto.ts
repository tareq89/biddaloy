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
import { InvoiceStatus } from '@beton-boi/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

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
